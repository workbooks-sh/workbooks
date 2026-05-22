/**
 * Broker-MCP fallback transport for `rpc.setFallback()`.
 *
 * When a workbook isn't co-resident with the tool it wants to call,
 * the in-process bus can't route. This factory wires the broker's
 * aggregated workgroup MCP endpoint as the fallback so cross-host
 * calls still succeed — just slower than the bus.
 *
 * Usage:
 *
 *   import { rpc, brokerMcpFallback } from "@work.books/runtime";
 *
 *   rpc.setFallback(brokerMcpFallback({
 *     workgroupId: "wg_abc",
 *     apiBase: "https://workbooks.sh",   // optional, defaults to wb-api-base
 *   }));
 *
 * Notes:
 *   - The broker's MCP route is `/v1/groups/<id>/mcp`; it speaks
 *     JSON-RPC 2.0 (`tools/call`).
 *   - Tool names at the broker are pre-namespaced `wb__<workbook>__<tool>`.
 *     The fallback passes the toolName through verbatim — callers
 *     that don't already use the namespaced form should prefer the
 *     bus, which uses bare tool names.
 *   - Cookies (`credentials: "include"`) carry the recipient's
 *     hosted-viewer session. For standalone use the workbook must
 *     have been opened through a host that planted a session cookie;
 *     otherwise the broker returns 401 and the fallback throws.
 *
 * wb-1ru.5.
 */

import { WbRpcError } from "./index";

export type BrokerFallbackOptions = {
  /** Workgroup id at the broker (matches the GroupRow.id). */
  workgroupId: string;
  /** Override the API base. Defaults to `<meta name="wb-api-base">`
   *  if present, else https://workbooks.sh. */
  apiBase?: string;
};

export function brokerMcpFallback(
  opts: BrokerFallbackOptions,
): (toolName: string, args: Record<string, unknown>) => Promise<unknown> {
  const apiBase = (opts.apiBase ?? detectApiBase()).replace(/\/+$/, "");
  const url = `${apiBase}/v1/groups/${encodeURIComponent(opts.workgroupId)}/mcp`;

  return async (toolName, args) => {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new WbRpcError(
        `broker_http_${res.status}`,
        `broker MCP ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const payload = (await res.json()) as {
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      error?: { code: number; message: string };
    };
    if (payload.error) {
      throw new WbRpcError(
        `broker_rpc_${payload.error.code}`,
        payload.error.message,
      );
    }
    const content = payload.result?.content ?? [];
    const text = content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
    if (payload.result?.isError) {
      throw new WbRpcError("broker_tool_error", text || `${toolName} failed`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
}

function detectApiBase(): string {
  if (typeof document === "undefined") return "https://workbooks.sh";
  const meta = document.querySelector('meta[name="wb-api-base"]') as HTMLMetaElement | null;
  const fromMeta = meta?.content?.trim();
  return fromMeta || "https://workbooks.sh";
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
