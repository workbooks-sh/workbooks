/**
 * Credential resolution for `wb.db(slot)` under the Studio-required
 * policy.
 *
 * Order:
 *   1. Studio-bound — parent frame posts
 *        { type: "wb:bind:database", slot, credentials: {...} }
 *      at boot. Used in Studio + the workbooks.sh hosted viewer.
 *   2. Baked anon config — `<script id="wb-databases-baked">` with
 *      non-secret config (anon Supabase keys for public-RLS demos
 *      and dev-mode workbook.local.json builds). Opt-in build-time
 *      via `workbook build --bake-public-db` / `--embed-private`, or
 *      automatically populated by `workbook dev`.
 *   3. No host, no baked, production build → render Studio-required
 *      takeover splash. The workbook stops running; user clicks
 *      through to open it in Studio.
 *   4. No host, no baked, dev build → throw a typed error so the
 *      author sees what's missing without the splash hijacking the
 *      dev loop.
 *
 * What's gone (vs the pre-x8g design):
 *   - localStorage credential storage. The "recipient pastes URL +
 *     key into a modal" path was the source of slug-collision risk
 *     and the trust-ask copy debt. Templates without baked creds
 *     belong in Studio.
 *   - The first-run config panel modal.
 *   - writeLocalStorageCredentials.
 */

import { floater } from "../floater";

export type DbKind = "supabase" | "convex" | "turso";

export type DbCredentials = {
  url: string;
  key: string;
};

export class WbDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WbDatabaseError";
  }
}

/** Thrown in non-DOM contexts (test runners, SSR) or in dev mode when
 *  a slot has no resolved credentials. Caller can catch + handle. */
export class WbDatabaseNeedsConfig extends WbDatabaseError {
  constructor(public slot: string, public kind: DbKind) {
    super(
      `wb.db(${JSON.stringify(slot)}): no credentials for kind=${kind}. ` +
        `Bind via a host (Studio postMessage), bake at build time ` +
        `(--bake-public-db / workbook.local.json), or open this workbook ` +
        `in Studio.`,
    );
    this.name = "WbDatabaseNeedsConfig";
  }
}

/** Thrown in production builds when a connected workbook has no host
 *  to resolve credentials. By the time author code sees this, the
 *  takeover splash has already replaced document.body — the throw is
 *  just to keep author promise chains from hanging. */
export class WbConnectedWorkbookRequiresStudio extends WbDatabaseError {
  constructor(public slot: string, public kind: DbKind) {
    super(
      `wb.db(${JSON.stringify(slot)}): this workbook needs a host (Studio) ` +
        `to reach its ${kind} connection. Opened outside Studio; the page ` +
        `has been replaced with a redirect splash.`,
    );
    this.name = "WbConnectedWorkbookRequiresStudio";
  }
}

type BindingEnvelope = {
  type: "wb:bind:database";
  slot: string;
  credentials: DbCredentials;
};

const bindings = new Map<string, DbCredentials>();
const pending = new Map<string, Array<(c: DbCredentials) => void>>();

let listenerInstalled = false;
let splashRendered = false;

/** Normalize a credential URL into a browser-safe form. Turso shares
 *  one logical host between its native libsql:// driver and the HTTP
 *  /v2/pipeline endpoint — the browser can only fetch https. */
function normalizeUrl(url: string): string {
  if (url.startsWith("libsql://")) return "https://" + url.slice("libsql://".length);
  if (url.startsWith("libsqls://")) return "https://" + url.slice("libsqls://".length);
  return url;
}

export function installListener() {
  if (listenerInstalled || typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("message", (ev) => {
    const data = ev.data as Partial<BindingEnvelope> | null;
    if (!data || data.type !== "wb:bind:database") return;
    if (typeof data.slot !== "string" || !data.credentials) return;
    const creds = data.credentials;
    if (typeof creds.url !== "string") return;
    if (typeof creds.key !== "string") return;
    const normalized: DbCredentials = { url: normalizeUrl(creds.url), key: creds.key };
    bindings.set(data.slot, normalized);
    // Any prior "needs config" nudge for this slot is stale now.
    floater.remove(`wb:db:${data.slot}`);
    const waiters = pending.get(data.slot);
    if (waiters) {
      pending.delete(data.slot);
      for (const fn of waiters) fn(normalized);
    }
  });
  announceSlots();
  maybeRenderEagerSplash();
}

/** Render the takeover splash AT BOOT (not lazily on first wb.db
 *  call) when we can prove there's no host: top-level frame, no
 *  baked creds, production build, declared slots. Avoids the flash
 *  of broken workbook content that would otherwise show until the
 *  author's first failed wb.db().fetch(). Iframe workbooks skip
 *  this — the host might still postMessage shortly. */
function maybeRenderEagerSplash(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.parent !== window) return; // iframe — host might bind
  if (readBuildMode() !== "production") return;
  const slots = readDeclaredSlots();
  if (slots.length === 0) return;
  // If every declared slot has baked creds, no splash needed.
  const allBaked = slots.every((s) => readBaked(s.name) !== null);
  if (allBaked) return;
  // Pick the first slot without baked creds for the splash copy.
  const unbound = slots.find((s) => readBaked(s.name) === null);
  if (!unbound) return;
  // Defer one tick so the body has actually rendered into the DOM
  // by the time we replace it; otherwise document.body.innerHTML
  // assignment can race the decompression shim's document.write.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () =>
      renderTakeoverSplash(unbound.name, unbound.kind),
    );
  } else {
    renderTakeoverSplash(unbound.name, unbound.kind);
  }
}

function announceSlots() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (window.parent === window) return; // top-level, no host to ask
  const slots = readDeclaredSlots();
  if (slots.length === 0) return;
  try {
    window.parent.postMessage({ type: "wb:request:database", slots }, "*");
  } catch {
    /* parent inaccessible — splash path will catch it */
  }
}

function readDeclaredSlots(): Array<{ name: string; kind: DbKind }> {
  if (typeof document === "undefined") return [];
  const el = document.getElementById("wb-databases");
  if (!el) return [];
  try {
    const parsed = JSON.parse(el.textContent ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is { name: string; kind: DbKind } =>
          !!s &&
          typeof (s as { name?: unknown }).name === "string" &&
          ((s as { kind?: unknown }).kind === "supabase" ||
            (s as { kind?: unknown }).kind === "convex" ||
            (s as { kind?: unknown }).kind === "turso"),
      );
  } catch {
    return [];
  }
}

function readBaked(slot: string): DbCredentials | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("wb-databases-baked");
  if (!el) return null;
  try {
    const raw = JSON.parse(el.textContent ?? "{}");
    const entry = raw?.[slot];
    if (!entry || typeof entry !== "object") return null;
    if (typeof entry.url !== "string" || typeof entry.key !== "string") {
      return null;
    }
    return { url: normalizeUrl(entry.url), key: entry.key };
  } catch {
    return null;
  }
}

function readBuildMode(): "production" | "dev" {
  if (typeof document === "undefined") return "dev";
  const el = document.querySelector('meta[name="wb-build-mode"]');
  const content = el?.getAttribute("content");
  return content === "production" ? "production" : "dev";
}

type WorkbookSpec = {
  manifest?: {
    slug?: string;
    title?: string;
    description?: string;
  };
};

function readWorkbookSpec(): WorkbookSpec {
  if (typeof document === "undefined") return {};
  const el = document.getElementById("workbook-spec");
  if (!el) return {};
  try {
    return JSON.parse(el.textContent ?? "{}");
  } catch {
    return {};
  }
}

type HostHint = {
  name: string;
  url: string;
  splashColor: string;
  logoSvg: string | null;
};

const DEFAULT_HOST: HostHint = {
  name: "Workbooks Studio",
  url: "https://studio.workbooks.sh",
  splashColor: "#84cc16",
  logoSvg: null,
};

/** Read the optional host pointer (wb-7xx). Falls back to
 *  workbooks.sh defaults so the splash works today without the host
 *  config landing. */
function readHostHint(): HostHint {
  if (typeof document === "undefined") return DEFAULT_HOST;
  const el = document.getElementById("wb-host");
  if (!el) return DEFAULT_HOST;
  try {
    const raw = JSON.parse(el.textContent ?? "{}");
    return {
      name: typeof raw?.name === "string" ? raw.name : DEFAULT_HOST.name,
      url: typeof raw?.url === "string" ? raw.url : DEFAULT_HOST.url,
      splashColor:
        typeof raw?.splashColor === "string"
          ? raw.splashColor
          : DEFAULT_HOST.splashColor,
      logoSvg: typeof raw?.logoSvg === "string" ? raw.logoSvg : null,
    };
  } catch {
    return DEFAULT_HOST;
  }
}

/** Resolve credentials for a slot. */
export async function resolveDbCredentials(
  slot: string,
  kind: DbKind,
): Promise<DbCredentials> {
  installListener();

  const bound = bindings.get(slot);
  if (bound) return bound;

  const baked = readBaked(slot);
  if (baked) {
    bindings.set(slot, baked);
    return baked;
  }

  // Wait briefly for a postMessage from the host before falling back.
  const earlyBind = await waitForBinding(slot, 250);
  if (earlyBind) return earlyBind;

  if (typeof document === "undefined") {
    throw new WbDatabaseNeedsConfig(slot, kind);
  }

  // No host responded and no baked creds. Production builds render
  // the takeover splash (one-shot — the rest of the slots' resolves
  // see the page already gone and throw fast). Dev builds throw a
  // typed error so the author sees what's missing without a UX
  // hijack on every `workbook dev` HMR cycle.
  if (readBuildMode() === "production") {
    renderTakeoverSplash(slot, kind);
    throw new WbConnectedWorkbookRequiresStudio(slot, kind);
  }
  // Dev build with no resolved creds — surface in the floater so the
  // author sees a visible nudge instead of just a thrown error in the
  // console. wb-721.
  const KIND_LABEL: Record<DbKind, string> = {
    supabase: "Supabase",
    convex: "Convex",
    turso: "Turso",
  };
  const host = readHostHint();
  floater.add({
    id: `wb:db:${slot}`,
    label: `Connect ${KIND_LABEL[kind]} for "${slot}"`,
    cta: "Open Studio",
    href: `${host.url.replace(/\/+$/, "")}/integrations`,
    glyph: KIND_LABEL[kind].slice(0, 1),
    tone: "warn",
  });
  throw new WbDatabaseNeedsConfig(slot, kind);
}

function waitForBinding(slot: string, ms: number): Promise<DbCredentials | null> {
  return new Promise((resolve) => {
    const waiters = pending.get(slot) ?? [];
    const handler = (creds: DbCredentials) => {
      cleanup();
      resolve(creds);
    };
    waiters.push(handler);
    pending.set(slot, waiters);
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, ms);
    function cleanup() {
      clearTimeout(timer);
      const list = pending.get(slot);
      if (!list) return;
      pending.set(
        slot,
        list.filter((fn) => fn !== handler),
      );
    }
  });
}

// ── takeover splash ───────────────────────────────────────────────
//
// Replaces document.body with a "this workbook needs Studio" page.
// One-shot — subsequent calls are no-ops so multi-slot workbooks
// don't restack splash content. Reads wb-host for branding (defaults
// to workbooks.sh).

function renderTakeoverSplash(slot: string, kind: DbKind): void {
  if (splashRendered || typeof document === "undefined") return;
  splashRendered = true;

  const spec = readWorkbookSpec();
  const host = readHostHint();
  const slug = spec.manifest?.slug ?? "";
  const title = spec.manifest?.title ?? slug ?? "Workbook";

  const KIND_LABEL: Record<DbKind, string> = {
    supabase: "Supabase",
    convex: "Convex",
    turso: "Turso",
  };

  // We don't have the broker-issued workbook id in the artifact
  // (the CLI's workbook-spec carries slug, not id — id is minted at
  // publish time and stays on the broker row). Deep-link to the
  // host's library; the user picks the right workbook from there
  // OR uploads it. wb-7xx will add a workbook-id field to the spec
  // and this can deep-link more accurately then.
  const ctaUrl = host.url.replace(/\/+$/, "") + "/workbooks";

  const logoBlock = host.logoSvg
    ? host.logoSvg
    : `<div class="logo-fallback"></div>`;

  document.title = `${title} — open in ${host.name}`;

  document.body.innerHTML = `
    <main class="wb-studio-splash">
      <div class="wb-splash-card">
        <div class="wb-splash-logo">${logoBlock}</div>
        <p class="wb-splash-kicker">${escapeHtml(host.name)}</p>
        <h1 class="wb-splash-title">${escapeHtml(title)}</h1>
        <p class="wb-splash-lede">
          This workbook reaches a <strong>${KIND_LABEL[kind]}</strong>
          ${
            readDeclaredSlots().length > 1
              ? "(among others)"
              : ""
          }
          connection that lives in <strong>${escapeHtml(host.name)}</strong>.
          Opened directly it has no way to authenticate — open it in your
          host to sign in and resolve credentials.
        </p>
        <a class="wb-splash-cta" href="${escapeAttr(ctaUrl)}">
          Open in ${escapeHtml(host.name)}
        </a>
        <p class="wb-splash-foot">
          Workbook: <code>${escapeHtml(slug)}</code>
        </p>
      </div>
    </main>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #09090b; color: #e4e4e7;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .wb-studio-splash {
        min-height: 100vh; display: flex; align-items: center; justify-content: center;
        padding: 32px; box-sizing: border-box;
      }
      .wb-splash-card {
        max-width: 480px; width: 100%; background: #18181b; border: 1px solid #27272a;
        border-radius: 16px; padding: 32px; text-align: center;
        box-shadow: 0 24px 64px -16px rgba(0, 0, 0, 0.5);
      }
      .wb-splash-logo {
        width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 14px;
        background: ${host.splashColor}; display: flex; align-items: center; justify-content: center;
        color: #0f1115; font-size: 26px; font-weight: 700;
      }
      .wb-splash-logo .logo-fallback {
        width: 24px; height: 24px; border-radius: 6px; background: #0f1115;
      }
      .wb-splash-kicker {
        margin: 0 0 6px; font-size: 11px; color: #a1a1aa;
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .wb-splash-title {
        margin: 0 0 14px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em;
        color: #fafafa; line-height: 1.2;
      }
      .wb-splash-lede {
        margin: 0 0 24px; color: #a1a1aa; line-height: 1.5; font-size: 14px;
      }
      .wb-splash-lede strong { color: #fafafa; font-weight: 600; }
      .wb-splash-cta {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 10px 22px; border-radius: 10px; background: ${host.splashColor}; color: #0f1115;
        text-decoration: none; font-weight: 500; font-size: 14px;
        transition: opacity 0.12s;
      }
      .wb-splash-cta:hover { opacity: 0.88; }
      .wb-splash-foot {
        margin: 22px 0 0; color: #71717a; font-size: 12px;
      }
      .wb-splash-foot code {
        background: #27272a; color: #d4d4d8;
        padding: 2px 7px; border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
      }
    </style>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
