/**
 * `wb.db(slot)` — browser-safe database handle.
 *
 * Authors declare slots in workbook.config.mjs:
 *
 *   databases: {
 *     main:  { kind: "supabase", access: "rls" },
 *     cache: { kind: "turso" },
 *   }
 *
 * The CLI bakes the slot list into `<script id="wb-databases">`. At
 * runtime, `wb.db("main")` reads that manifest, resolves credentials
 * via dbBinding, and returns a thin handle.
 *
 * v1 scope is intentionally minimal — we don't bundle the official
 * Supabase / Convex / Turso SDKs. Authors get:
 *
 *   await h.credentials()        // { url, key }
 *   await h.fetch(path, init?)   // pre-authenticated fetch
 *
 * Authors who want a richer client can `import { createClient }` from
 * the official package and pass our credentials into it — the binding
 * resolver still drives the priority chain.
 */

import {
  resolveDbCredentials,
  type DbCredentials,
  type DbKind,
  WbDatabaseError,
} from "./dbBinding";

export type { DbCredentials, DbKind };
export { WbDatabaseError };

export interface WbDatabase {
  readonly slot: string;
  readonly kind: DbKind;
  /** Resolves to the slot's credentials. May wait briefly for Studio
   *  to inject; throws WbDatabaseNeedsConfig if no source matches. */
  credentials(): Promise<DbCredentials>;
  /** Pre-authenticated fetch. `path` may be absolute (returns as-is)
   *  or relative (joined against the slot's base URL). Per-kind auth
   *  headers are applied automatically — callers can override by
   *  passing their own. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

type DbSlotDecl = {
  name: string;
  kind: DbKind;
  access?: string;
  agentAccess?: boolean;
};

let manifestCache: DbSlotDecl[] | null = null;

function readManifest(): DbSlotDecl[] {
  if (manifestCache !== null) return manifestCache;
  if (typeof document === "undefined") {
    manifestCache = [];
    return manifestCache;
  }
  const el = document.getElementById("wb-databases");
  if (!el) {
    manifestCache = [];
    return manifestCache;
  }
  try {
    const parsed = JSON.parse(el.textContent ?? "[]");
    manifestCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    manifestCache = [];
  }
  return manifestCache;
}

export function createDb(slot: string): WbDatabase {
  const decl = readManifest().find((d) => d.name === slot);
  if (!decl) {
    throw new WbDatabaseError(
      `wb.db(${JSON.stringify(slot)}): slot is not declared. ` +
        `Add it to workbook.config.mjs > databases: { ${slot}: { kind: "supabase" | "convex" | "turso" } }.`,
    );
  }
  const kind = decl.kind;

  return {
    slot,
    kind,
    credentials() {
      return resolveDbCredentials(slot, kind);
    },
    async fetch(path: string, init: RequestInit = {}) {
      const creds = await resolveDbCredentials(slot, kind);
      const headers = new Headers(init.headers);
      applyAuth(kind, creds, headers);
      const url = joinUrl(creds.url, path);
      return globalThis.fetch(url, { ...init, headers });
    },
  };
}

function applyAuth(kind: DbKind, creds: DbCredentials, headers: Headers) {
  switch (kind) {
    case "supabase":
      if (creds.key) {
        if (!headers.has("apikey")) headers.set("apikey", creds.key);
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${creds.key}`);
        }
      }
      return;
    case "turso":
      if (creds.key && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${creds.key}`);
      }
      return;
    case "convex":
      // Public reads against a Convex deployment URL need no auth.
      // Deploy key (when present) goes as Bearer for /api endpoints.
      if (creds.key && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${creds.key}`);
      }
      return;
  }
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!path) return base;
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}
