// Convert a session bundle (from `workbook session <id> --format=json`)
// into an OTLP-HTTP JSON envelope using OpenInference semantic
// conventions. Postable to any OTel collector (primary target:
// Arize Phoenix self-hosted at http://localhost:6006/v1/traces).
//
// Why this layer: every observability tool (Phoenix, Langfuse,
// Honeycomb, etc.) speaks OTLP. Emitting OpenInference-shaped spans
// means our agents' traces are immediately consumable by the
// open-source ecosystem with no vendor-specific instrumentation.
//
// Span hierarchy (OpenInference v2):
//   AGENT  agent.session  (root, the whole session)
//     AGENT  agent.turn.<idx>  (per turn)
//       LLM  llm  (per responseId — one model invocation)
//       TOOL tool.<name>  (per tool call)
// Errors land as SpanStatus=ERROR on the relevant parent.

import { randomBytes } from "node:crypto";

const SCOPE_NAME = "@work.books/cli";
const SCOPE_VERSION = "0.10.0";

export function bundleToOTLP(bundle) {
  const session = bundle?.session ?? null;
  const turns = Array.isArray(bundle?.turns) ? bundle.turns : [];
  const events = Array.isArray(bundle?.events) ? bundle.events : [];
  if (!session?._id) {
    throw new Error("bundleToOTLP: session bundle missing session._id");
  }

  const traceId = traceIdFromSessionId(session._id);
  const spans = [];

  // Root: the whole session.
  const sessionStart = msToNano(session.startedAt ?? events[0]?.ts ?? Date.now());
  const sessionEnd = msToNano(session.completedAt ?? events.at(-1)?.ts ?? Date.now());
  const rootSpanId = newSpanId();
  spans.push({
    traceId,
    spanId: rootSpanId,
    name: "agent.session",
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: sessionStart,
    endTimeUnixNano: sessionEnd,
    attributes: [
      attr("openinference.span.kind", "AGENT"),
      attr("session.id", session._id),
      attr("user.id", session.userId ?? ""),
      attr("organization.id", session.organizationId ?? ""),
      attr("gen_ai.system", "workhorse"),
      attr("gen_ai.request.model", session.model ?? "unknown"),
      attr("runtime.target", session.runtimeTarget ?? ""),
      attr("runtime.adapter", session.sandbox ?? ""),
      attr("runtime.reason", session.runtimeReason ?? ""),
      attr("input.value", String(turns[0]?.prompt ?? "")),
      attr("output.value", lastFinalAssistantText(events) ?? ""),
    ],
    status: spanStatusFromSession(session),
  });

  // Per turn.
  for (const t of turns) {
    const turnStart = msToNano(t.startedAt ?? sessionStart / 1_000_000);
    const turnEnd = msToNano(t.completedAt ?? turnStart / 1_000_000);
    const turnEvents = events.filter((e) => (e.turnIndex ?? 0) === (t.turnIndex ?? 0));
    const turnSpanId = newSpanId();
    spans.push({
      traceId,
      spanId: turnSpanId,
      parentSpanId: rootSpanId,
      name: `agent.turn.${t.turnIndex ?? 0}`,
      kind: 1,
      startTimeUnixNano: turnStart,
      endTimeUnixNano: turnEnd,
      attributes: [
        attr("openinference.span.kind", "AGENT"),
        attr("turn.index", t.turnIndex ?? 0),
        attr("turn.status", t.status ?? ""),
        attr("input.value", String(t.prompt ?? "")),
        attr("output.value", lastFinalAssistantText(turnEvents) ?? ""),
      ],
      status: spanStatusFromTurn(t, turnEvents),
    });

    // Per LLM response within this turn.
    const responses = groupByResponseId(turnEvents);
    for (const r of responses) {
      const llmSpanId = newSpanId();
      const usage = findUsageForTurn(turnEvents, t.turnIndex ?? 0);
      spans.push({
        traceId,
        spanId: llmSpanId,
        parentSpanId: turnSpanId,
        name: "llm",
        kind: 1,
        startTimeUnixNano: msToNano(r.firstTs),
        endTimeUnixNano: msToNano(r.lastTs),
        attributes: [
          attr("openinference.span.kind", "LLM"),
          attr("llm.model_name", session.model ?? "unknown"),
          attr("llm.provider", inferProvider(session.model ?? "")),
          attr("llm.response_id", r.responseId),
          attr("llm.output_messages.0.message.role", "assistant"),
          attr("llm.output_messages.0.message.content", r.text ?? ""),
          ...(usage ? [
            attr("llm.token_count.prompt", Number(usage.input ?? 0)),
            attr("llm.token_count.completion", Number(usage.output ?? 0)),
            attr("llm.token_count.total", Number(usage.totalTokens ?? (Number(usage.input ?? 0) + Number(usage.output ?? 0)))),
            ...(usage.cost?.total != null ? [attr("llm.cost_usd", Number(usage.cost.total))] : []),
          ] : []),
          attr("llm.stop_reason", r.stopReason ?? ""),
        ],
        status: r.stopReason === "error"
          ? { code: 2, message: "stopReason=error" }
          : { code: 1 },
      });
    }

    // Per tool call within this turn.
    const toolCalls = pairToolCallsByTurn(turnEvents);
    for (const tc of toolCalls) {
      spans.push({
        traceId,
        spanId: newSpanId(),
        parentSpanId: turnSpanId,
        name: `tool.${tc.toolName}`,
        kind: 1,
        startTimeUnixNano: msToNano(tc.startTs),
        endTimeUnixNano: msToNano(tc.endTs ?? tc.startTs),
        attributes: [
          attr("openinference.span.kind", "TOOL"),
          attr("tool.name", tc.toolName),
          attr("tool.parameters", tc.args ? JSON.stringify(tc.args).slice(0, 4000) : ""),
          attr("tool.output", tc.output ? compactStr(tc.output).slice(0, 4000) : ""),
          attr("tool.call_id", tc.toolCallId ?? ""),
        ],
        status: tc.isError ? { code: 2, message: "tool returned isError" } : { code: 1 },
      });
    }
  }

  return {
    resourceSpans: [{
      resource: {
        attributes: [
          attr("service.name", "workbooks-agent"),
          attr("service.version", SCOPE_VERSION),
          attr("session.id", session._id),
        ],
      },
      scopeSpans: [{
        scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
        spans,
      }],
    }],
  };
}

// --- helpers ------------------------------------------------------

function newSpanId() {
  return randomBytes(8).toString("hex");
}

function traceIdFromSessionId(sessionId) {
  // OTel trace_id is 16 bytes (32 hex). Derive deterministically from
  // the session id so a session always maps to one trace, even on
  // repeated exports.
  const buf = Buffer.alloc(16);
  const src = Buffer.from(sessionId, "utf8");
  for (let i = 0; i < 16; i++) buf[i] = src[i % src.length] ^ (i + 1);
  return buf.toString("hex");
}

function msToNano(ms) {
  return String(BigInt(Math.floor(ms)) * 1_000_000n);
}

function attr(key, value) {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value ?? "") } };
}

function spanStatusFromSession(s) {
  if (s.status === "error") return { code: 2, message: s.statusDetail ?? "session error" };
  if (s.status === "cancelled") return { code: 2, message: "cancelled" };
  return { code: 1 };
}

function spanStatusFromTurn(t, events) {
  if (t.status === "error") return { code: 2, message: "turn error" };
  // Check for any error event on this turn
  if (events.some((e) => e.kind === "error")) return { code: 2, message: "error event on turn" };
  return { code: 1 };
}

function inferProvider(model) {
  if (!model) return "";
  if (model.includes(":")) return model.split(":", 1)[0];
  if (model.includes("/")) return model.split("/", 1)[0];
  return "";
}

function groupByResponseId(events) {
  const m = new Map();
  for (const e of events) {
    if (e.kind !== "message_delta") continue;
    const rid = e.payload?.responseId ?? `delta-${e._id}`;
    const prev = m.get(rid);
    const text = typeof e.payload?.text === "string" ? e.payload.text : "";
    if (!prev) {
      m.set(rid, { responseId: rid, firstTs: e.ts, lastTs: e.ts, text, stopReason: e.payload?.stopReason ?? null });
    } else {
      prev.lastTs = e.ts;
      if (text.length > prev.text.length) prev.text = text;
      if (e.payload?.stopReason) prev.stopReason = e.payload.stopReason;
    }
  }
  return [...m.values()].sort((a, b) => a.firstTs - b.firstTs);
}

function findUsageForTurn(events, turnIndex) {
  for (const e of events) {
    if (e.kind !== "agent_end") continue;
    if ((e.turnIndex ?? 0) !== turnIndex) continue;
    if (e.payload?.usage && typeof e.payload.usage === "object") return e.payload.usage;
  }
  return null;
}

function pairToolCallsByTurn(events) {
  const starts = new Map();
  const out = [];
  for (const e of events) {
    if (e.kind === "tool_start") {
      const id = e.payload?.toolCallId ?? `${e._id}`;
      starts.set(id, e);
    } else if (e.kind === "tool_end") {
      const id = e.payload?.toolCallId ?? `${e._id}`;
      const start = starts.get(id);
      starts.delete(id);
      out.push({
        toolCallId: id,
        toolName: e.payload?.toolName ?? start?.payload?.toolName ?? "tool",
        args: start?.payload?.args ?? null,
        output: e.payload?.output ?? null,
        isError: Boolean(e.payload?.isError),
        startTs: start ? start.ts : e.ts,
        endTs: e.ts,
      });
    }
  }
  for (const [id, start] of starts) {
    out.push({
      toolCallId: id,
      toolName: start.payload?.toolName ?? "tool",
      args: start.payload?.args ?? null,
      output: null,
      isError: false,
      startTs: start.ts,
      endTs: start.ts,
    });
  }
  return out;
}

function lastFinalAssistantText(events) {
  const responses = groupByResponseId(events);
  if (responses.length === 0) return null;
  return responses.map((r) => r.text).filter(Boolean).join("\n\n") || null;
}

function compactStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
