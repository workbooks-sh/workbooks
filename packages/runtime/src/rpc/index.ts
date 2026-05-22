/**
 * Cross-workbook tool RPC — runtime side.
 *
 * Two workbooks open in the same browser session (Studio canvas,
 * workbooks.sh viewer with multiple embeds, etc.) can call each
 * other's declared tools without the broker round-trip. The host
 * page acts as a bus: it owns the routing table of which workbook
 * iframe handles which tool.
 *
 * Three render modes selected at boot, same pattern as the floater
 * primitive in ../floater/:
 *
 *   1. **Host-routed** — iframe with a host that responds to
 *      wb:rpc:hello with wb:rpc:ack within 250ms. The workbook
 *      registers its local handlers with the host (one wb:rpc:expose
 *      per declared tool) and forwards outbound calls upstream.
 *      Inbound calls (host → workbook for tools this workbook owns)
 *      arrive as wb:rpc:call envelopes; the runtime dispatches and
 *      replies with wb:rpc:result.
 *
 *   2. **Standalone (top-level frame)** — no host. Calls to non-local
 *      tools throw WbRpcNoRoute. Local tools (this workbook's own
 *      declared tools) still work — the registry doubles as the
 *      workbook's own tool dispatcher.
 *
 *   3. **Iframe with no responsive host** — same as standalone after
 *      the 250ms boot window expires.
 *
 * Future: HTTP MCP fallback (workgroup endpoint) when host says
 * "I don't know that tool either." Plumbing is in place via the
 * `setFallback` hook; v1 doesn't ship a default transport because
 * the runtime doesn't yet have an MCP-over-HTTP client.
 *
 * wb-1ru.5 + wb-1ru.6.
 */

export type RpcHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export type RpcToolDecl = {
  /** Tool name as declared in workbook.config.mjs > tools. */
  name: string;
  /** Optional human description; carried for diagnostics. */
  description?: string;
};

type CallEnvelope = {
  type: "wb:rpc:call";
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
};

type ResultEnvelope = {
  type: "wb:rpc:result";
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

type ExposeEnvelope = {
  type: "wb:rpc:expose";
  workbookSlug: string;
  tools: RpcToolDecl[];
};

type ListEnvelope = {
  type: "wb:rpc:list";
  listId: string;
};

type ListResultEnvelope = {
  type: "wb:rpc:list:result";
  listId: string;
  tools: Array<RpcToolDecl & { workbookSlug: string }>;
};

type AckEnvelope = { type: "wb:rpc:ack" };
type HelloEnvelope = { type: "wb:rpc:hello" };

type RpcEnvelope =
  | CallEnvelope
  | ResultEnvelope
  | ExposeEnvelope
  | ListEnvelope
  | ListResultEnvelope
  | AckEnvelope
  | HelloEnvelope;

export class WbRpcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "WbRpcError";
  }
}

export class WbRpcNoRoute extends WbRpcError {
  constructor(toolName: string) {
    super(
      "no_route",
      `wb.rpc.call(${JSON.stringify(toolName)}): no local handler and no host bus to route through. ` +
        `Open this workbook in a host (Studio) for cross-workbook tools.`,
    );
    this.name = "WbRpcNoRoute";
  }
}

type RpcMode = "unknown" | "host-routed" | "standalone";

const localHandlers = new Map<string, RpcHandler>();
const pendingCalls = new Map<string, {
  resolve: (v: unknown) => void;
  reject: (e: WbRpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const pendingLists = new Map<string, {
  resolve: (tools: Array<RpcToolDecl & { workbookSlug: string }>) => void;
  reject: (e: WbRpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
let nextListSeq = 1;
let mode: RpcMode = "unknown";
let bootInstalled = false;
let helloTimer: ReturnType<typeof setTimeout> | null = null;
const queueBeforeBoot: RpcEnvelope[] = [];
let fallback: ((toolName: string, args: Record<string, unknown>) => Promise<unknown>) | null = null;
let nextCallSeq = 1;

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** Read declared tools from <script id="wb-tools"> OR (back-compat)
 *  workbook-spec.manifest.tools. The CLI emits wb-tools as part of
 *  the wb-capabilities block; we tolerate either location so older
 *  artifacts still work. */
function readDeclaredTools(): RpcToolDecl[] {
  if (typeof document === "undefined") return [];
  // Newer artifacts split tools into their own tag — try that first.
  const toolsTag = document.getElementById("wb-tools");
  if (toolsTag?.textContent) {
    try {
      const arr = JSON.parse(toolsTag.textContent);
      if (Array.isArray(arr)) {
        return arr.filter((t) => t && typeof t.name === "string");
      }
    } catch {
      /* fall through */
    }
  }
  // Fall back to workbook-spec.manifest.tools — the CLI emits this as
  // an array of {name, description?, input_schema?} after extractToolDeclarations.
  const specTag = document.getElementById("workbook-spec");
  if (specTag?.textContent) {
    try {
      const spec = JSON.parse(specTag.textContent);
      const tools = spec?.manifest?.tools;
      if (Array.isArray(tools)) {
        return tools
          .filter((t) => t && typeof t.name === "string")
          .map((t) => ({
            name: t.name,
            description: typeof t.description === "string" ? t.description : undefined,
          }));
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

function readWorkbookSlug(): string {
  if (typeof document === "undefined") return "(unknown)";
  const tag = document.getElementById("workbook-spec");
  if (!tag?.textContent) return "(unknown)";
  try {
    const spec = JSON.parse(tag.textContent);
    return typeof spec?.manifest?.slug === "string"
      ? spec.manifest.slug
      : "(unknown)";
  } catch {
    return "(unknown)";
  }
}

function dispatch(env: RpcEnvelope): void {
  installBoot();
  if (mode === "unknown") {
    queueBeforeBoot.push(env);
    return;
  }
  if (mode === "host-routed") {
    try {
      window.parent.postMessage(env, "*");
    } catch {
      /* parent gone — degrade */
      mode = "standalone";
    }
  }
  // standalone: nothing to forward; local-only.
}

function installBoot(): void {
  if (bootInstalled || typeof window === "undefined") return;
  bootInstalled = true;

  window.addEventListener("message", handleEnvelope);

  if (window.parent === window) {
    mode = "standalone";
    flushQueue();
    return;
  }

  try {
    window.parent.postMessage({ type: "wb:rpc:hello" } satisfies HelloEnvelope, "*");
  } catch {
    mode = "standalone";
    flushQueue();
    return;
  }

  helloTimer = setTimeout(() => {
    if (mode === "unknown") {
      mode = "standalone";
      flushQueue();
    }
    helloTimer = null;
  }, 250);
}

function handleEnvelope(ev: MessageEvent): void {
  const data = ev.data as RpcEnvelope | null;
  if (!data || typeof data !== "object" || !("type" in data)) return;

  if (data.type === "wb:rpc:ack") {
    if (mode !== "unknown") return;
    mode = "host-routed";
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
    // Announce our local tools to the host so it can route inbound
    // calls back to us. Then flush any queued outbound envelopes.
    const tools = readDeclaredTools();
    if (tools.length > 0) {
      try {
        window.parent.postMessage(
          {
            type: "wb:rpc:expose",
            workbookSlug: readWorkbookSlug(),
            tools,
          } satisfies ExposeEnvelope,
          "*",
        );
      } catch {
        /* parent gone before we could expose */
      }
    }
    flushQueue();
    return;
  }

  if (data.type === "wb:rpc:call") {
    handleInboundCall(data, ev);
    return;
  }

  if (data.type === "wb:rpc:result") {
    const pending = pendingCalls.get(data.callId);
    if (!pending) return;
    pendingCalls.delete(data.callId);
    clearTimeout(pending.timer);
    if (data.ok) {
      pending.resolve(data.result);
    } else {
      const err = data.error;
      pending.reject(
        new WbRpcError(err?.code ?? "remote_error", err?.message ?? "remote error"),
      );
    }
    return;
  }

  if (data.type === "wb:rpc:list:result") {
    const pending = pendingLists.get(data.listId);
    if (!pending) return;
    pendingLists.delete(data.listId);
    clearTimeout(pending.timer);
    pending.resolve(Array.isArray(data.tools) ? data.tools : []);
    return;
  }
}

function flushQueue(): void {
  if (mode === "host-routed") {
    for (const env of queueBeforeBoot) {
      try {
        window.parent.postMessage(env, "*");
      } catch {
        /* parent gone — drop */
      }
    }
  }
  // standalone: outbound envelopes had no destination; drop.
  queueBeforeBoot.length = 0;
}

async function handleInboundCall(env: CallEnvelope, ev: MessageEvent): Promise<void> {
  const replyTarget = (ev.source as Window | MessagePort | null) ?? window.parent;
  const post = (msg: ResultEnvelope) => {
    try {
      const target = replyTarget && "postMessage" in replyTarget
        ? (replyTarget as { postMessage: (m: unknown, o?: { targetOrigin?: string }) => void })
        : null;
      if (target) {
        target.postMessage(msg, { targetOrigin: "*" });
      }
    } catch {
      /* reply path broken — caller times out */
    }
  };
  const handler = localHandlers.get(env.toolName);
  if (!handler) {
    post({
      type: "wb:rpc:result",
      callId: env.callId,
      ok: false,
      error: { code: "no_handler", message: `tool ${env.toolName} not registered` },
    });
    return;
  }
  try {
    const result = await handler(env.args);
    post({ type: "wb:rpc:result", callId: env.callId, ok: true, result });
  } catch (e) {
    post({
      type: "wb:rpc:result",
      callId: env.callId,
      ok: false,
      error: {
        code: "handler_error",
        message: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

// ── public API ─────────────────────────────────────────────────────

/** Register a handler for one of this workbook's declared tools. */
function register(toolName: string, handler: RpcHandler): void {
  if (typeof toolName !== "string" || !toolName) return;
  if (typeof handler !== "function") return;
  localHandlers.set(toolName, handler);
  installBoot();
}

/** Call a tool by name. Prefers local handlers; falls through to
 *  the host bus; falls through again to the configured fallback
 *  transport (HTTP MCP, etc.) if set. */
async function call<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  if (typeof toolName !== "string" || !toolName) {
    throw new WbRpcError("bad_args", "wb.rpc.call: toolName must be a non-empty string");
  }
  installBoot();
  const local = localHandlers.get(toolName);
  if (local) {
    return (await local(args)) as T;
  }
  if (mode === "unknown") {
    // Wait for the boot window to settle before deciding fallback.
    await new Promise((r) => setTimeout(r, 260));
  }
  if (mode === "host-routed") {
    return await callViaHost<T>(toolName, args, opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
  }
  if (fallback) {
    return (await fallback(toolName, args)) as T;
  }
  throw new WbRpcNoRoute(toolName);
}

function callViaHost<T>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const callId = `${Date.now().toString(36)}-${(nextCallSeq++).toString(36)}`;
    const timer = setTimeout(() => {
      pendingCalls.delete(callId);
      reject(new WbRpcError("timeout", `wb.rpc.call(${toolName}): timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingCalls.set(callId, {
      resolve: (v) => resolve(v as T),
      reject,
      timer,
    });
    try {
      window.parent.postMessage(
        {
          type: "wb:rpc:call",
          callId,
          toolName,
          args,
        } satisfies CallEnvelope,
        "*",
      );
    } catch {
      pendingCalls.delete(callId);
      clearTimeout(timer);
      reject(new WbRpcError("parent_gone", "host bus unreachable"));
    }
  });
}

/** List every tool the bus can route — local handlers plus all tools
 *  the host's routing table knows about. Useful for discovery before
 *  blindly invoking unknown tools. In standalone mode (no host bus),
 *  returns only this workbook's own declared tools.
 *
 *  Hosts are expected to scope the response per-caller (e.g. only
 *  return tools from workbooks the caller's workgroup has access to).
 *  Standalone workbooks see local tools only. */
async function listTools(
  opts: { timeoutMs?: number } = {},
): Promise<Array<RpcToolDecl & { workbookSlug: string }>> {
  installBoot();
  const localSlug = readWorkbookSlug();
  const local: Array<RpcToolDecl & { workbookSlug: string }> = [];
  for (const name of localHandlers.keys()) {
    local.push({ name, workbookSlug: localSlug });
  }

  if (mode === "unknown") {
    await new Promise((r) => setTimeout(r, 260));
  }
  if (mode !== "host-routed") {
    // Standalone — surface declared tools too (handlers haven't been
    // registered yet but the workbook still SAYS it has these).
    const declared = readDeclaredTools();
    const declaredNames = new Set(local.map((t) => t.name));
    for (const t of declared) {
      if (!declaredNames.has(t.name)) {
        local.push({ ...t, workbookSlug: localSlug });
      }
    }
    return local;
  }

  const timeoutMs = opts.timeoutMs ?? 2_000;
  const remote = await new Promise<Array<RpcToolDecl & { workbookSlug: string }>>(
    (resolve, reject) => {
      const listId = `${Date.now().toString(36)}-${(nextListSeq++).toString(36)}`;
      const timer = setTimeout(() => {
        pendingLists.delete(listId);
        reject(new WbRpcError("timeout", `wb.rpc.listTools(): host did not respond within ${timeoutMs}ms`));
      }, timeoutMs);
      pendingLists.set(listId, { resolve, reject, timer });
      try {
        window.parent.postMessage(
          { type: "wb:rpc:list", listId } satisfies ListEnvelope,
          "*",
        );
      } catch {
        pendingLists.delete(listId);
        clearTimeout(timer);
        reject(new WbRpcError("parent_gone", "host bus unreachable"));
      }
    },
  );

  // Merge — host-returned tools are authoritative for non-local
  // entries; local handlers always appear with this workbook's slug.
  const merged = new Map<string, RpcToolDecl & { workbookSlug: string }>();
  for (const t of remote) {
    merged.set(`${t.workbookSlug}/${t.name}`, t);
  }
  for (const t of local) {
    merged.set(`${t.workbookSlug}/${t.name}`, t);
  }
  return Array.from(merged.values());
}

/** Configure a fallback transport for tools the host bus can't route.
 *  Intended for an HTTP MCP client (workgroup endpoint). v1 ships
 *  no default — the runtime stays transport-agnostic. */
function setFallback(
  fn: ((toolName: string, args: Record<string, unknown>) => Promise<unknown>) | null,
): void {
  fallback = fn;
}

/** Test-only. Resets module state so each test starts clean. Not
 *  exported from the package barrel. */
function _resetForTests(): void {
  localHandlers.clear();
  for (const p of pendingCalls.values()) clearTimeout(p.timer);
  pendingCalls.clear();
  for (const p of pendingLists.values()) clearTimeout(p.timer);
  pendingLists.clear();
  queueBeforeBoot.length = 0;
  mode = "unknown";
  bootInstalled = false;
  fallback = null;
  if (helloTimer !== null) {
    clearTimeout(helloTimer);
    helloTimer = null;
  }
}

export const rpc = { register, call, listTools, setFallback };
export { _resetForTests };
