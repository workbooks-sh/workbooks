/**
 * Workbook → backend connection client.
 *
 * Workbooks declare integrations in `workbook.config.mjs`:
 *
 *     integrations: ["gmail", "github"]
 *
 * That bakes a <script id="wb-integrations"> tag into the artifact.
 * Recipients connect each one via Studio → Integrations; the hosted
 * viewer (workbooks.sh) prompts before running anything.
 *
 * At runtime, the workbook calls a toolkit action like:
 *
 *     import { connections } from "@work.books/runtime";
 *
 *     await connections.execute("gmail", "GMAIL_SEND_EMAIL", {
 *       to: "shane@example.com",
 *       subject: "hello",
 *       body: "from a workbook",
 *     });
 *
 * The call goes through our backend (broker → Convex), which:
 *   1. Authenticates the recipient (their viewer session cookie).
 *   2. Resolves the right connection per the grant the recipient
 *      approved when they opened the workbook.
 *   3. Executes the action via the integrations provider and returns
 *      the structured result.
 *
 * The workbook never sees raw OAuth tokens or API keys. Swapping the
 * underlying integrations provider doesn't change this surface.
 *
 * Resolution defaults:
 *   - apiBase: read from <meta name="wb-api-base"> or "/api"
 *   - workbookId: read from <script id="wb-meta"> JSON, or
 *                 <meta name="wb-workbook-id">
 */

import { floater } from "./floater";

export interface ConnectionsClient {
  /** Invoke an action on a connected toolkit. */
  execute<T = unknown>(
    toolkit: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  /** Override the API base (defaults to "/api"). */
  configure(opts: { apiBase?: string; workbookId?: string }): void;
  /** List of integration slugs this workbook declared (from
   *  wb-integrations tag), useful for showing your own connect UI. */
  declared(): string[];
}

interface RuntimeOptions {
  apiBase: string;
  workbookId: string | null;
}

class ConnectionsClientImpl implements ConnectionsClient {
  private opts: RuntimeOptions;
  constructor() {
    this.opts = {
      apiBase: detectApiBase(),
      workbookId: detectWorkbookId(),
    };
  }

  configure(opts: { apiBase?: string; workbookId?: string }): void {
    if (opts.apiBase) this.opts.apiBase = opts.apiBase.replace(/\/$/, "");
    if (opts.workbookId) this.opts.workbookId = opts.workbookId;
  }

  declared(): string[] {
    if (typeof document === "undefined") return [];
    const tag = document.getElementById("wb-integrations");
    if (!tag) return [];
    try {
      const arr = JSON.parse(tag.textContent ?? "[]");
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  async execute<T = unknown>(
    toolkit: string,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await fetch(`${this.opts.apiBase}/connections/execute`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workbookId: this.opts.workbookId,
        toolkitSlug: toolkit,
        actionSlug: action,
        params,
      }),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      const err = new ConnectionsError(
        `connection_execute_http_${res.status}`,
        detail || `HTTP ${res.status}`,
        res.status,
      );
      maybeSurfaceFloater(toolkit, err);
      throw err;
    }
    const body = (await res.json()) as {
      ok: boolean;
      result?: T;
      errorCode?: string;
      errorMessage?: string;
    };
    if (!body.ok) {
      const err = new ConnectionsError(
        body.errorCode ?? "execute_failed",
        body.errorMessage ?? "execute failed",
        res.status,
      );
      maybeSurfaceFloater(toolkit, err);
      throw err;
    }
    // Success — clear any prior "not connected" nudge so the floater
    // doesn't keep nagging after the user actually wired it up.
    floater.remove(`wb:int:${toolkit}`);
    return body.result as T;
  }
}

/** Push a floater item when an execute() failure looks like the
 *  toolkit isn't connected for this recipient. Idempotent — readd
 *  with the same id replaces the prior entry. Conservative on the
 *  match: missing connections return 401 + a recognizable code or
 *  message. Other failures (rate limit, upstream timeout) should NOT
 *  add a "Connect <toolkit>" nudge. */
function maybeSurfaceFloater(toolkit: string, err: ConnectionsError): void {
  if (err.httpStatus !== 401 && err.httpStatus !== 403) {
    // Other statuses occasionally carry the same signal via code.
    if (!/not_connected|no_connection|no_grant|missing_toolkit|toolkit_not_connected/i.test(err.code)) {
      return;
    }
  }
  // Read the host hint so the CTA points at the right Studio.
  const hostUrl = readHostUrl();
  floater.add({
    id: `wb:int:${toolkit}`,
    label: `Connect ${prettyToolkit(toolkit)}`,
    cta: "Open Studio",
    href: `${hostUrl.replace(/\/+$/, "")}/integrations`,
    glyph: prettyToolkit(toolkit).slice(0, 1).toUpperCase(),
    tone: "warn",
  });
}

function prettyToolkit(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((s) => (s.length ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" ");
}

function readHostUrl(): string {
  if (typeof document === "undefined") return "https://studio.workbooks.sh";
  const el = document.getElementById("wb-host");
  if (!el) return "https://studio.workbooks.sh";
  try {
    const raw = JSON.parse(el.textContent ?? "{}");
    return typeof raw?.url === "string" ? raw.url : "https://studio.workbooks.sh";
  } catch {
    return "https://studio.workbooks.sh";
  }
}

export class ConnectionsError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number,
  ) {
    super(message);
    this.name = "ConnectionsError";
  }
}

function detectApiBase(): string {
  if (typeof document === "undefined") return "/api";
  const meta = document.querySelector(
    'meta[name="wb-api-base"]',
  ) as HTMLMetaElement | null;
  const fromMeta = meta?.content?.trim();
  if (fromMeta) return fromMeta.replace(/\/$/, "");
  return "/api";
}

function detectWorkbookId(): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector(
    'meta[name="wb-workbook-id"]',
  ) as HTMLMetaElement | null;
  if (meta?.content) return meta.content;
  const script = document.getElementById("wb-meta");
  if (script?.textContent) {
    try {
      const parsed = JSON.parse(script.textContent) as { workbook_id?: string };
      if (parsed.workbook_id) return parsed.workbook_id;
    } catch {
      /* fall through */
    }
  }
  return null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/** Lazy singleton — created on first access. */
let _singleton: ConnectionsClient | null = null;

export const connections: ConnectionsClient = new Proxy({} as ConnectionsClient, {
  get(_, prop) {
    if (!_singleton) _singleton = new ConnectionsClientImpl();
    const value = (_singleton as unknown as Record<string, unknown>)[
      prop as string
    ];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(_singleton)
      : value;
  },
});
