// Aggregate a raw session-export bundle into an operator-friendly
// observability summary. Works against the existing event stream
// (no Convex schema changes required) so we can validate the view
// design before any backend work lands.
//
// Designed to be both the CLI's pretty-print source AND the eval
// framework's eventual replacement for raw event parsing.

export function aggregate(bundle) {
  const events = Array.isArray(bundle?.events) ? bundle.events : [];
  const session = bundle?.session ?? null;
  const turns = Array.isArray(bundle?.turns) ? bundle.turns : [];

  // Errors classifier — gives the canonical mystery shapes
  // (agent_end with null stopReason, postEvent 401, model 402) a
  // first-class category instead of leaving the operator to grep.
  // We pass turns so we can flag "tool calls ran but no assistant
  // text" even before agent_end fires.
  const errors = classifyErrors(events, turns);

  // Tools called: paired tool_start / tool_end with success status.
  const toolCalls = pairToolCalls(events);

  // Model calls inferred from message_delta + agent_end.usage.
  // Today usage is often null; we surface that as "unreported" rather
  // than pretending zero.
  const modelCalls = inferModelCalls(events, session);

  // Per-turn timeline.
  const turnsTimeline = buildTurnsTimeline(turns, events);

  const summary = {
    sessionId: session?._id ?? null,
    agentId: session?.agentId ?? null,
    status: session?.status ?? "unknown",
    statusDetail: session?.statusDetail ?? null,
    runtime: {
      target: session?.runtimeTarget ?? null,
      adapter: session?.sandbox ?? null,
      reason: session?.runtimeReason ?? null,
    },
    model: session?.model ?? null,
    timing: {
      startedAt: session?.startedAt ?? null,
      completedAt: session?.completedAt ?? null,
      durationMs: session?.startedAt && session?.completedAt
        ? session.completedAt - session.startedAt
        : null,
    },
    tokens: aggregateTokens(modelCalls),
    counts: {
      turns: turns.length,
      events: events.length,
      toolCalls: toolCalls.length,
      toolFailures: toolCalls.filter((t) => t.isError).length,
      errors: errors.length,
    },
  };

  return {
    summary,
    turns: turnsTimeline,
    toolCalls,
    modelCalls,
    errors,
  };
}

// -- internals -----------------------------------------------------

function classifyErrors(events, turns = []) {
  const out = [];
  // First pass: per-turn "did work, said nothing" detection that doesn't
  // require an agent_end event. Useful for sessions still in flight or
  // sessions whose agent_end was lost.
  const NOW = Date.now();
  const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 min without completion → stuck
  for (const t of turns) {
    const turnEvents = events.filter((e) => (e.turnIndex ?? 0) === (t.turnIndex ?? 0));
    const sawMessage = turnEvents.some((e) => e.kind === "message_delta" && (e.payload?.text ?? "").length > 0);
    const sawToolEnd = turnEvents.some((e) => e.kind === "tool_end");
    const sawAnyTool = turnEvents.some((e) => e.kind === "tool_start" || e.kind === "tool_end");
    // Stuck turn: status still "running"/"pending" long after start
    if ((t.status === "running" || t.status === "pending") && t.startedAt && (NOW - t.startedAt) > STUCK_THRESHOLD_MS) {
      out.push({
        category: "stuck_turn",
        message: `turn has been ${t.status} for ${Math.round((NOW - t.startedAt) / 60_000)}min — likely zombie`,
        phase: "turn",
        turnIndex: t.turnIndex,
        ts: t.startedAt,
        source: "inferred.turn",
      });
      continue; // don't double-classify
    }
    if (!sawMessage && sawAnyTool && (t.status === "completed" || t.status === "done" || sawToolEnd)) {
      out.push({
        category: "silent_completion",
        message: "turn made tool calls but produced no assistant text",
        phase: "turn",
        turnIndex: t.turnIndex,
        ts: t.completedAt ?? t.startedAt ?? 0,
        source: "inferred.turn",
      });
    } else if (!sawMessage && !sawAnyTool && (t.status === "completed" || t.status === "done")) {
      out.push({
        category: "empty_response",
        message: "turn completed without any LLM output or tool call",
        phase: "turn",
        turnIndex: t.turnIndex,
        ts: t.completedAt ?? t.startedAt ?? 0,
        source: "inferred.turn",
      });
    }
  }
  for (const e of events) {
    if (e.kind === "error") {
      out.push({
        category: classifyExplicit(e.payload?.message ?? ""),
        message: (e.payload?.message ?? "").slice(0, 500),
        phase: e.payload?.phase ?? null,
        turnIndex: e.turnIndex ?? null,
        ts: e.ts,
        source: "runner.error",
      });
      continue;
    }
    if (e.kind === "agent_end") {
      // Inspect: was there ANY message_delta AND any tool_execution_end
      // in this same turn? If neither, the model never produced output —
      // canonical silent-failure shape.
      const turnIdx = e.turnIndex ?? 0;
      const sameTurnEvents = events.filter((x) => (x.turnIndex ?? 0) === turnIdx && x.ts <= e.ts);
      const sawMessage = sameTurnEvents.some((x) => x.kind === "message_delta" && (x.payload?.text ?? "").length > 0);
      const sawTool = sameTurnEvents.some((x) => x.kind === "tool_execution_end" || x.kind === "tool_end");
      if (!sawMessage && !sawTool) {
        out.push({
          category: "empty_response",
          message: "agent_end fired without any LLM output or tool call",
          phase: "turn",
          turnIndex: turnIdx,
          ts: e.ts,
          source: "inferred",
        });
      } else if (!sawMessage && sawTool) {
        // wb-vfg0 shape — agent did work, never spoke.
        out.push({
          category: "silent_completion",
          message: "agent did tool work but produced no final message_delta",
          phase: "turn",
          turnIndex: turnIdx,
          ts: e.ts,
          source: "inferred",
        });
      }
    }
  }
  return out;
}

function classifyExplicit(msg) {
  const m = msg.toLowerCase();
  if (/40[12]/.test(m) && /credit|max_tokens|payment/.test(m)) return "upstream_402";
  if (/40[12]/.test(m) && /unauthorized|unauthenticated|forbidden/.test(m)) return "auth";
  if (/timeout|timed out/.test(m)) return "timeout";
  if (/server error|5\d\d|internal error/.test(m)) return "upstream_5xx";
  if (/tool.*fail|isError/.test(m)) return "tool_failed";
  return "unknown";
}

function pairToolCalls(events) {
  const starts = new Map(); // toolCallId → start event
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
        durationMs: start ? e.ts - start.ts : null,
        turnIndex: e.turnIndex ?? start?.turnIndex ?? 0,
        ts: e.ts,
      });
    }
  }
  // Any tool_start without a tool_end is an in-flight or lost call.
  for (const [id, start] of starts) {
    out.push({
      toolCallId: id,
      toolName: start.payload?.toolName ?? "tool",
      args: start.payload?.args ?? null,
      output: null,
      isError: false,
      durationMs: null,
      turnIndex: start.turnIndex ?? 0,
      ts: start.ts,
      unterminated: true,
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function inferModelCalls(events, session) {
  // Today the only place token usage shows up is agent_end.payload.usage
  // (often null) and message_delta.payload.responseId (groups deltas
  // belonging to the same model response). One response per responseId.
  const byResponse = new Map();
  for (const e of events) {
    if (e.kind !== "message_delta") continue;
    const rid = e.payload?.responseId ?? `delta-${e._id}`;
    const prev = byResponse.get(rid);
    if (!prev) {
      byResponse.set(rid, {
        responseId: rid,
        firstTs: e.ts,
        lastTs: e.ts,
        stopReason: e.payload?.stopReason ?? null,
        textChars: (e.payload?.text ?? "").length,
        turnIndex: e.turnIndex ?? 0,
      });
    } else {
      prev.lastTs = e.ts;
      prev.textChars = Math.max(prev.textChars, (e.payload?.text ?? "").length);
      if (e.payload?.stopReason) prev.stopReason = e.payload.stopReason;
    }
  }
  // Attach usage from agent_end if present (sometimes pi-agent-core
  // emits per-turn agent_end with usage; sometimes null).
  const usagesByTurn = new Map();
  for (const e of events) {
    if (e.kind !== "agent_end") continue;
    const u = e.payload?.usage;
    if (u && typeof u === "object") usagesByTurn.set(e.turnIndex ?? 0, u);
  }
  const out = [];
  for (const r of byResponse.values()) {
    const u = usagesByTurn.get(r.turnIndex);
    out.push({
      ...r,
      durationMs: r.lastTs - r.firstTs,
      usage: u ?? null,
      model: session?.model ?? null,
    });
  }
  out.sort((a, b) => a.firstTs - b.firstTs);
  return out;
}

function aggregateTokens(modelCalls) {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  let costUsd = 0;
  let unreported = 0;
  for (const c of modelCalls) {
    if (!c.usage) { unreported++; continue; }
    input += Number(c.usage.input ?? 0);
    output += Number(c.usage.output ?? 0);
    cacheRead += Number(c.usage.cacheRead ?? 0);
    cacheWrite += Number(c.usage.cacheWrite ?? 0);
    if (c.usage.cost?.total) costUsd += Number(c.usage.cost.total);
  }
  return {
    input, output, cacheRead, cacheWrite, costUsd,
    unreportedCalls: unreported,
    totalCalls: modelCalls.length,
  };
}

function buildTurnsTimeline(turns, events) {
  return turns.map((t) => {
    const turnEvents = events.filter((e) => (e.turnIndex ?? 0) === (t.turnIndex ?? 0));
    const tools = turnEvents.filter((e) => e.kind === "tool_end");
    const errors = turnEvents.filter((e) => e.kind === "error");
    let assistantText = null;
    for (const e of turnEvents) {
      if (e.kind === "message_delta" && typeof e.payload?.text === "string") {
        assistantText = e.payload.text;
      }
    }
    return {
      turnIndex: t.turnIndex,
      status: t.status,
      prompt: (t.prompt ?? "").slice(0, 200),
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      durationMs: t.completedAt && t.startedAt ? t.completedAt - t.startedAt : null,
      assistantChars: assistantText ? assistantText.length : 0,
      toolCount: tools.length,
      toolFailures: tools.filter((e) => e.payload?.isError).length,
      errorCount: errors.length,
    };
  });
}
