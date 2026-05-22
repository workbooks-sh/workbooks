/**
 * Workbook floater — runtime-side primitive.
 *
 * Bottom-corner pill that surfaces actionable status about the
 * workbook the user is currently looking at (missing creds,
 * unconnected integrations, etc). One consistent visual touchpoint
 * across every shape (document / notebook / spa) and every host
 * (Studio, workbooks.sh viewer, standalone file://).
 *
 * Two render modes — selected at boot:
 *
 *   1. **Forwarded** — workbook is in an iframe and the host responds
 *      to `wb:floater:hello` within 250ms. The runtime registry
 *      forwards `wb:floater:add` / `wb:floater:remove` upstream so
 *      Studio shows a single consolidated surface across embedded
 *      workbooks. No local DOM gets mounted.
 *
 *   2. **Self-rendered** — top-level frame, OR iframe with no
 *      responding host. Lazy-mounts a plain DOM widget on the first
 *      add() call. CSS inlined; zero Svelte dependency so it works
 *      uniformly across every workbook shape.
 *
 * Authors don't construct items directly in v1 — connection modules
 * (dbBinding, integrations) push items via the imported registry.
 * Once stable, we may expose `wb.floater.add(...)` for ad-hoc author
 * use.
 *
 * Dismissal is per-tab (in-memory). Across reloads a real gap
 * resurfaces — silent forever is a worse failure mode than mildly
 * naggy. wb-721.
 */

export type FloaterTone = "info" | "warn";

export type FloaterItem = {
  /** Stable key; readd with the same id is idempotent. Used for
   *  per-item dismissal + dedup. */
  id: string;
  label: string;
  cta: string;
  /** Where the CTA navigates. Treated as href on a real <a>; cross-
   *  origin links work. */
  href: string;
  glyph?: string;
  tone?: FloaterTone;
};

type ForwardEnvelope =
  | { type: "wb:floater:hello" }
  | { type: "wb:floater:ack" }
  | { type: "wb:floater:add"; item: FloaterItem }
  | { type: "wb:floater:remove"; id: string };

type HostMode = "unknown" | "self-render" | "forwarded";

const items = new Map<string, FloaterItem>();
const dismissed = new Set<string>();
let mode: HostMode = "unknown";
let mountedRoot: HTMLElement | null = null;
let collapsed = false;
let bootInstalled = false;
let helloTimer: ReturnType<typeof setTimeout> | null = null;
const queueBeforeBoot: ForwardEnvelope[] = [];

/** Author opt-out — workbook.config.mjs floater:false emits
 *  <meta name="wb-floater" content="off">. We honor that by making
 *  every public mutator a no-op; the rest of the module never
 *  initializes. Read once at module load to avoid per-call DOM
 *  queries. */
const optedOut: boolean = (() => {
  if (typeof document === "undefined") return false;
  const meta = document.querySelector('meta[name="wb-floater"]');
  return meta?.getAttribute("content") === "off";
})();

function installBoot(): void {
  if (bootInstalled || typeof window === "undefined") return;
  bootInstalled = true;

  if (window.parent === window) {
    // Top-level frame — host can't exist, render locally.
    mode = "self-render";
    return;
  }

  // In an iframe. Listen for an ack from the host, then choose mode.
  window.addEventListener("message", (ev) => {
    const data = ev.data as Partial<ForwardEnvelope> | null;
    if (!data || data.type !== "wb:floater:ack") return;
    if (mode !== "unknown") return; // already decided
    mode = "forwarded";
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
    // Flush anything queued during the boot window.
    for (const env of queueBeforeBoot) {
      try {
        window.parent.postMessage(env, "*");
      } catch {
        /* parent inaccessible */
      }
    }
    queueBeforeBoot.length = 0;
  });

  try {
    window.parent.postMessage({ type: "wb:floater:hello" }, "*");
  } catch {
    /* parent inaccessible — fall through to self-render */
    mode = "self-render";
    flushQueue();
    return;
  }

  // 250ms ceiling — same budget as the dbBinding host wait. If the
  // host doesn't ack, render locally.
  helloTimer = setTimeout(() => {
    if (mode === "unknown") {
      mode = "self-render";
      flushQueue();
    }
    helloTimer = null;
  }, 250);
}

function flushQueue(): void {
  // Self-render path: replay queued envelopes through the local
  // mutators so the DOM catches up.
  for (const env of queueBeforeBoot) {
    if (env.type === "wb:floater:add") {
      items.set(env.item.id, env.item);
    } else if (env.type === "wb:floater:remove") {
      items.delete(env.id);
    }
  }
  queueBeforeBoot.length = 0;
  if (items.size > 0) renderLocal();
}

function dispatch(env: ForwardEnvelope): void {
  installBoot();
  if (mode === "unknown") {
    queueBeforeBoot.push(env);
    return;
  }
  if (mode === "forwarded") {
    try {
      window.parent.postMessage(env, "*");
    } catch {
      /* parent gone — degrade to local */
      mode = "self-render";
      if (env.type === "wb:floater:add") items.set(env.item.id, env.item);
      else if (env.type === "wb:floater:remove") items.delete(env.id);
      renderLocal();
    }
    return;
  }
  // self-render
  if (env.type === "wb:floater:add") items.set(env.item.id, env.item);
  else if (env.type === "wb:floater:remove") items.delete(env.id);
  renderLocal();
}

export function add(item: FloaterItem): void {
  if (optedOut) return;
  if (!item || typeof item.id !== "string") return;
  dispatch({ type: "wb:floater:add", item });
}

export function remove(id: string): void {
  if (optedOut) return;
  if (typeof id !== "string") return;
  dispatch({ type: "wb:floater:remove", id });
}

export function dismiss(id: string): void {
  if (optedOut) return;
  if (typeof id !== "string") return;
  dismissed.add(id);
  if (mode === "self-render") renderLocal();
}

/** Test-only reset. Not exported from the package barrel. */
export function _resetForTests(): void {
  items.clear();
  dismissed.clear();
  mode = "unknown";
  bootInstalled = false;
  queueBeforeBoot.length = 0;
  if (helloTimer !== null) {
    clearTimeout(helloTimer);
    helloTimer = null;
  }
  if (mountedRoot && mountedRoot.parentNode) {
    mountedRoot.parentNode.removeChild(mountedRoot);
  }
  mountedRoot = null;
  collapsed = false;
}

// ── self-render DOM widget ────────────────────────────────────────

const STYLE_TAG_ID = "wb-floater-style";

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `
    .wb-floater {
      position: fixed; bottom: 18px; left: 18px; z-index: 2147483640;
      background: #18181b; border: 1px solid #27272a; border-radius: 12px;
      box-shadow: 0 18px 48px -16px rgba(0, 0, 0, 0.55);
      min-width: 260px; max-width: 360px; color: #e4e4e7;
      font: 13px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .wb-floater.collapsed { min-width: 0; }
    .wb-floater .toggle {
      display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 8px 12px; background: transparent; border: 0;
      color: inherit; font: inherit; cursor: pointer; border-radius: 12px;
    }
    .wb-floater .toggle:hover { background: #27272a; }
    .wb-floater:not(.collapsed) .toggle { border-radius: 12px 12px 0 0; }
    .wb-floater .count {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
      background: #f59e0b; color: #1a1a1f;
      font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
    }
    .wb-floater .toggle-label { flex: 1; text-align: left; }
    .wb-floater .chev { width: 14px; height: 14px; color: #a1a1aa; }
    .wb-floater .items {
      list-style: none; margin: 0; padding: 4px;
      display: flex; flex-direction: column; gap: 2px;
      border-top: 1px solid #27272a;
    }
    .wb-floater .item {
      display: grid; grid-template-columns: auto 1fr auto auto;
      align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
    }
    .wb-floater .item:hover { background: #27272a; }
    .wb-floater .glyph {
      width: 22px; height: 22px; border-radius: 6px; background: #27272a;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px;
    }
    .wb-floater .item.warn .glyph {
      background: rgba(245, 158, 11, 0.12); color: #f59e0b;
    }
    .wb-floater .label {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .wb-floater .cta {
      color: #e4e4e7; background: #27272a; border: 1px solid #3f3f46;
      padding: 4px 10px; border-radius: 6px; font-size: 12px;
      text-decoration: none; flex-shrink: 0;
    }
    .wb-floater .cta:hover { border-color: #71717a; }
    .wb-floater .dismiss {
      border: 0; background: transparent; color: #71717a;
      font-size: 16px; line-height: 1; width: 20px; height: 20px;
      border-radius: 4px; cursor: pointer; padding: 0;
    }
    .wb-floater .dismiss:hover { color: #e4e4e7; background: #27272a; }
  `;
  document.head.appendChild(style);
}

function ensureRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (mountedRoot) return mountedRoot;
  if (!document.body) return null;
  ensureStyle();
  const root = document.createElement("aside");
  root.className = "wb-floater";
  root.setAttribute("aria-label", "Workbook needs attention");
  document.body.appendChild(root);
  mountedRoot = root;
  return root;
}

function visibleItems(): FloaterItem[] {
  const out: FloaterItem[] = [];
  for (const it of items.values()) {
    if (!dismissed.has(it.id)) out.push(it);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLocal(): void {
  if (mode !== "self-render") return;
  if (typeof document === "undefined") return;
  // If the document body doesn't exist yet, defer until DOMContentLoaded.
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", renderLocal, { once: true });
    return;
  }
  const visible = visibleItems();
  if (visible.length === 0) {
    if (mountedRoot && mountedRoot.parentNode) {
      mountedRoot.parentNode.removeChild(mountedRoot);
      mountedRoot = null;
    }
    return;
  }
  const root = ensureRoot();
  if (!root) return;
  root.classList.toggle("collapsed", collapsed);
  const countLabel =
    visible.length === 1 ? "1 suggestion" : `${visible.length} suggestions`;
  const chev = collapsed
    ? `<polyline points="18 15 12 9 6 15" />`
    : `<polyline points="6 9 12 15 18 9" />`;
  const itemsHtml = collapsed
    ? ""
    : `<ul class="items">${visible
        .map(
          (i) => `
            <li class="item${i.tone === "warn" ? " warn" : ""}" data-id="${escapeHtml(i.id)}">
              ${i.glyph ? `<span class="glyph" aria-hidden="true">${escapeHtml(i.glyph)}</span>` : `<span class="glyph"></span>`}
              <span class="label">${escapeHtml(i.label)}</span>
              <a class="cta" href="${escapeHtml(i.href)}">${escapeHtml(i.cta)}</a>
              <button type="button" class="dismiss" aria-label="Dismiss" data-dismiss="${escapeHtml(i.id)}">×</button>
            </li>`,
        )
        .join("")}</ul>`;
  root.innerHTML = `
    <button type="button" class="toggle" aria-expanded="${!collapsed}"
            title="${collapsed ? "Show suggestions" : "Hide suggestions"}"
            data-toggle="1">
      <span class="count">${visible.length}</span>
      <span class="toggle-label">${countLabel}</span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${chev}
      </svg>
    </button>
    ${itemsHtml}
  `;
  // Event delegation — one handler covers toggle + dismiss.
  root.onclick = (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const dismissBtn = target.closest<HTMLElement>("[data-dismiss]");
    if (dismissBtn) {
      ev.preventDefault();
      dismiss(dismissBtn.dataset.dismiss!);
      return;
    }
    const toggle = target.closest<HTMLElement>("[data-toggle]");
    if (toggle) {
      ev.preventDefault();
      collapsed = !collapsed;
      renderLocal();
    }
  };
}

export const floater = { add, remove, dismiss };
