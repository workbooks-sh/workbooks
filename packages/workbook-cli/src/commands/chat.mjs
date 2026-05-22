// `workbook chat <agent> "<prompt>" [--session <id>] [--model <m>] [--json] [--debug]`
//
// Drives a chat session against your Workbooks Studio account from
// the CLI. Same surface as the web /chat — the session shows up in
// studio.workbooks.sh/chat?session=<id> as soon as the broker
// receives the start, and every event is logged to your activity
// feed.
//
// Output is streamed: assistant text prints as it's generated, tool
// calls render as bracketed lines, render-block events print a
// compact JSON summary.
//
// Flags:
//   --json       raw event lines for scripting
//   --debug      surface diagnostic events (runner boot, git substrate
//                clone/push, etc.) inline as muted lines. Useful for
//                watching the runtime layer of a session as it runs.

import { ensureBearer } from "./publish.mjs";
import { spawn } from "node:child_process";

const DEFAULT_BROKER = process.env.WORKBOOKS_BROKER ?? "https://auth.workbooks.sh";
const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export async function runChat(opts = {}) {
  const agent = opts._?.[0] ?? opts.agent;
  const prompt = opts._?.[1] ?? opts.prompt;
  if (!agent || !prompt) {
    throw new Error(
      "workbook chat: usage:\n" +
        "  workbook chat <agent-slug> \"<prompt>\"\n" +
        "  workbook chat <agent-slug> \"<follow-up>\" --session <id>\n" +
        "  workbook chat workhorse \"summarize my workbooks\" --json",
    );
  }
  const sessionId = opts.session ?? null;
  const asJson = opts.json === true || opts.format === "json";
  const debug = opts.debug === true;

  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });

  const startRes = await fetch(`${DEFAULT_BROKER}/v1/agents/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      agentSlug: agent,
      prompt,
      sessionId,
      model: opts.model,
      runtimeTarget: opts.runtime,
      // wb-r62g — run the session in a non-default org the caller
      // belongs to (slug or `personal:<sub>`). Unset = session default.
      orgId: opts.org,
    }),
  });
  const startText = await startRes.text();
  if (!startRes.ok) {
    throw new Error(`workbook chat: broker returned ${startRes.status}: ${startText.slice(0, 300)}`);
  }
  const startJson = JSON.parse(startText);
  const sid = startJson.sessionId ?? sessionId;
  if (!sid) {
    throw new Error(`workbook chat: no sessionId returned (${startText})`);
  }

  if (!asJson) {
    process.stderr.write(
      `[2m· session ${sid}\n· studio.workbooks.sh/chat?session=${encodeURIComponent(sid)}[0m\n\n`,
    );
    if (
      (startJson.runtimeTarget === "browser-run" || startJson.runnerRequired) &&
      !startJson.runnerOnline &&
      startJson.runnerUrl
    ) {
      process.stderr.write(
        `[2m· browser runner required\n· ${startJson.runnerUrl}[0m\n\n`,
      );
      if (opts.open !== false) {
        openUrl(startJson.runnerUrl);
      }
    }
  } else {
    /* `chat.open` matches the dotted-namespace convention used by
     * the other CLI commands (`session.list`, `agent.show`, etc.).
     * Streamed event objects keep their server-emitted snake_case
     * kinds (`message_delta`, `tool_start`, …) — those are the
     * sessionEvents shape. Wrap stream events with kind "event" so
     * consumers can tell lifecycle frames apart from data frames. */
    process.stdout.write(
      JSON.stringify({
        kind: "chat.open",
        sessionId: sid,
        runtimeTarget: startJson.runtimeTarget ?? null,
        runnerRequired: Boolean(startJson.runnerRequired),
        runnerOnline: Boolean(startJson.runnerOnline),
        runnerUrl: startJson.runnerUrl ?? null,
      }) + "\n",
    );
  }

  // Poll loop — track latest event ts, render incrementally.
  let since = 0;
  const seenMessageIds = new Map(); // responseId → last printed text length
  const seenToolStarts = new Set(); // toolCallId
  const seenToolEnds = new Set();   // toolCallId
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${DEFAULT_BROKER}/v1/agents/sessions/${encodeURIComponent(sid)}/poll?since=${since}`,
      { headers: { authorization: `Bearer ${bearer}` } },
    );
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`poll failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : [];
    if (events.length > 0) {
      since = events[events.length - 1].ts;
      for (const e of events) {
        if (asJson) {
          process.stdout.write(JSON.stringify(e) + "\n");
          continue;
        }
        renderEventToTerminal(e, seenMessageIds, seenToolStarts, seenToolEnds, debug);
      }
    }
    if (data.status === "done" || data.status === "error" || data.status === "cancelled") {
      if (asJson) {
        process.stdout.write(
          JSON.stringify({
            kind: "chat.close",
            sessionId: sid,
            status: data.status,
            statusDetail: data.statusDetail ?? null,
          }) + "\n",
        );
      } else {
        process.stderr.write(
          `\n[2m· session ${data.status}${data.statusDetail ? ": " + data.statusDetail : ""}[0m\n`,
        );
      }
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("workbook chat: poll timed out after 10 minutes");
}

function openUrl(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    platform === "win32"
      ? ["/c", "start", "", url]
      : [url];
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}

function renderEventToTerminal(e, seenMsgs, seenToolStarts, seenToolEnds, debug = false) {
  const out = process.stdout;
  if (e.kind === "message_delta") {
    // message_delta carries CUMULATIVE text, keyed by responseId.
    // Print only the diff (the new tail) for streaming feel.
    const p = e.payload ?? {};
    const key = p.responseId ?? `m-${e._id}`;
    const text = typeof p.text === "string" ? p.text : "";
    const lastLen = seenMsgs.get(key) ?? 0;
    if (text.length > lastLen) {
      out.write(text.slice(lastLen));
      seenMsgs.set(key, text.length);
    }
  } else if (e.kind === "tool_start") {
    const p = e.payload ?? {};
    const id = p.toolCallId ?? e._id;
    if (seenToolStarts.has(id)) return;
    seenToolStarts.add(id);
    const name = p.toolName ?? "tool";
    const args = compactArgs(p.args);
    out.write(`\n[36m▸ ${name}[0m[2m${args ? "  " + args : ""}[0m\n`);
  } else if (e.kind === "tool_end") {
    const p = e.payload ?? {};
    const id = p.toolCallId ?? e._id;
    if (seenToolEnds.has(id)) return;
    seenToolEnds.add(id);
    const tag = p.isError ? "[31m✗[0m" : "[32m✓[0m";
    const summary = compactOutput(p.output);
    out.write(`  ${tag} ${summary}\n`);
  } else if (e.kind === "block") {
    const block = e.payload?.block;
    if (!block) return;
    const kind = block.kind ?? "?";
    let summary = "";
    if (kind === "table" && Array.isArray(block.rows)) {
      summary = `${block.rows.length} rows × ${(block.columns ?? block.headers ?? []).length} cols`;
    } else if (kind === "chart") {
      summary = `chart ${block.chartKind ?? ""}`.trim();
    } else if (kind === "metric") {
      summary = `${block.label ?? ""}: ${block.value ?? ""}`;
    } else if (kind === "callout") {
      summary = `[${block.tone ?? "info"}] ${block.title ?? ""} ${block.text ?? ""}`;
    } else if (kind === "markdown") {
      summary = (block.text ?? "").split("\n")[0].slice(0, 120);
    }
    out.write(`\n[35m◆ render ${kind}[0m  [2m${summary}[0m\n`);
  } else if (e.kind === "error") {
    const p = e.payload ?? {};
    out.write(`\n[31m✗ error[0m  [2m${(p.message ?? JSON.stringify(p)).slice(0, 200)}[0m\n`);
  } else if (debug && e.kind === "diagnostic") {
    // Runner-internal events: boot:* steps, git substrate clone/push,
    // runner.log tails, etc. Useful for substrate / runtime debugging
    // (wb-acx2.4). Hidden by default to keep terminal output focused
    // on the chat itself.
    const p = e.payload ?? {};
    const name = p.name ?? "diag";
    const rest = { ...p };
    delete rest.name;
    const detail = Object.keys(rest).length ? "  " + compactArgs(rest) : "";
    out.write(`[2m· ${name}${detail}[0m\n`);
  } else if (debug) {
    // Catch-all so --debug genuinely surfaces every event kind the
    // broker streams (session_start, session_close, done) — the
    // lifecycle markers are useful for understanding session boundaries.
    out.write(`[2m· ${e.kind}[0m\n`);
  }
}

function compactArgs(args) {
  if (args === null || args === undefined) return "";
  if (typeof args !== "object") return String(args).slice(0, 80);
  try {
    const s = JSON.stringify(args);
    if (s.length <= 80) return s;
    return s.slice(0, 77) + "…";
  } catch {
    return "";
  }
}
function compactOutput(out) {
  if (out === null || out === undefined) return "";
  const s = typeof out === "string" ? out : JSON.stringify(out);
  const first = s.split("\n")[0];
  if (first.length <= 100) return first;
  return first.slice(0, 97) + "…";
}
