// `workbook session <id> [--format=md|json] [--out <file>]`
//
// Fetches a chat session bundle from auth.workbooks.sh — session row,
// every turn, every event (message_delta, tool_start, tool_end,
// block, etc.), artifacts, files, questions.
//
// Default format `md` renders a compact human-readable transcript an
// LLM (Claude Code, Cursor) can paste straight into context. Pass
// `--format=json` for the raw bundle.
//
// Auth uses the cached OAuth bearer (~/.config/workbooks/auth.json),
// so a first run may open a browser tab.

import fs from "node:fs/promises";
import { ensureBearer } from "./publish.mjs";

const DEFAULT_BROKER =
  process.env.WORKBOOKS_BROKER ?? "https://auth.workbooks.sh";

export async function runSession(opts = {}) {
  /* Subcommand dispatch (wb-xf44). The first positional is either a
   * literal subcommand (`list`, `log`, `cancel`, `inspect`) OR a
   * session id (legacy single-session export behavior). Anything
   * that doesn't match a known verb is treated as an id for
   * back-compat. */
  const first = opts._?.[0];
  switch (first) {
    case "list":
      return runSessionList({ ...opts, _: opts._.slice(1) });
    case "log":
      return runSessionLog({ ...opts, _: opts._.slice(1) });
    case "cancel":
      return runSessionCancel({ ...opts, _: opts._.slice(1) });
    case "inspect":
      return runSessionInspect({ ...opts, _: opts._.slice(1) });
  }

  const id = first ?? opts.id;
  if (!id) {
    throw new Error(
      "workbook session: missing session id or subcommand.\n" +
        "  workbook session list [--limit N] [--agent <slug>] [--status <s>]\n" +
        "  workbook session log <id> [--tail N] [--follow]\n" +
        "  workbook session cancel <id>\n" +
        "  workbook session inspect <id> [--json]\n" +
        "  workbook session <session-id>                    # export transcript (md by default)\n" +
        "  workbook session <session-id> --format=json\n" +
        "  workbook session <session-id> --out transcript.md",
    );
  }
  const format = opts.format ?? "md";
  if (format !== "md" && format !== "json") {
    throw new Error(`workbook session: --format must be 'md' or 'json' (got '${format}')`);
  }

  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const res = await fetch(
    `${DEFAULT_BROKER}/v1/agents/sessions/${encodeURIComponent(id)}/export`,
    { headers: { authorization: `Bearer ${bearer}` } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `workbook session: broker returned ${res.status}: ${detail.slice(0, 300)}`,
    );
  }
  const bundle = await res.json();

  const out =
    format === "json"
      ? JSON.stringify(bundle, null, 2) + "\n"
      : renderMarkdown(bundle);

  if (opts.out) {
    await fs.writeFile(opts.out, out);
    process.stdout.write(`wrote ${out.length} bytes → ${opts.out}\n`);
  } else {
    process.stdout.write(out);
  }
}

function renderMarkdown(bundle) {
  const { session, turns, events, artifacts, files, questions } = bundle;
  const lines = [];
  lines.push(`# Session ${session._id}`);
  lines.push("");
  lines.push(`- agent: \`${session.agentId}\``);
  lines.push(`- model: \`${session.model}\``);
  lines.push(`- status: **${session.status}**${session.statusDetail ? ` — ${session.statusDetail}` : ""}`);
  lines.push(`- started: ${new Date(session.startedAt).toISOString()}`);
  if (session.completedAt) {
    lines.push(`- completed: ${new Date(session.completedAt).toISOString()}`);
  }
  if (session.sandboxId) lines.push(`- sandbox: \`${session.sandboxId}\``);
  lines.push("");

  // Group events by turnIndex.
  const eventsByTurn = new Map();
  for (const e of events) {
    const arr = eventsByTurn.get(e.turnIndex) ?? [];
    arr.push(e);
    eventsByTurn.set(e.turnIndex, arr);
  }

  for (const turn of turns) {
    lines.push(`## Turn ${turn.turnIndex} — ${turn.status}`);
    lines.push("");
    lines.push("**Prompt:**");
    lines.push("> " + (turn.prompt || "").split("\n").join("\n> "));
    lines.push("");

    const turnEvents = eventsByTurn.get(turn.turnIndex) ?? [];
    const messages = collapseMessages(turnEvents);
    const toolCalls = collectToolCalls(turnEvents);
    const blocks = turnEvents.filter((e) => e.kind === "block");
    const errors = turnEvents.filter((e) => e.kind === "error");

    if (messages.length > 0) {
      lines.push("**Assistant output:**");
      for (const m of messages) {
        if (m.thinking) {
          lines.push("");
          lines.push("<details><summary>thinking</summary>");
          lines.push("");
          lines.push(m.thinking);
          lines.push("</details>");
        }
        if (m.text) {
          lines.push("");
          lines.push(m.text);
        }
      }
      lines.push("");
    }

    for (const t of toolCalls) {
      lines.push(`**tool call: \`${t.toolName}\`** ${t.isError ? "❌" : ""}`);
      if (t.args !== undefined) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(t.args, null, 2));
        lines.push("```");
      }
      if (t.output) {
        lines.push("");
        lines.push("```");
        lines.push(typeof t.output === "string" ? t.output : JSON.stringify(t.output, null, 2));
        lines.push("```");
      }
      lines.push("");
    }

    if (blocks.length > 0) {
      lines.push(`**rendered blocks (${blocks.length}):**`);
      lines.push("");
      lines.push("```json");
      lines.push(
        JSON.stringify(
          blocks.map((b) => b.payload?.block ?? b.payload),
          null,
          2,
        ),
      );
      lines.push("```");
      lines.push("");
    }

    if (errors.length > 0) {
      lines.push("**errors:**");
      for (const e of errors) {
        lines.push("- " + JSON.stringify(e.payload));
      }
      lines.push("");
    }
  }

  if (artifacts.length > 0) {
    lines.push(`## Artifacts (${artifacts.length})`);
    for (const a of artifacts) {
      lines.push(`- [\`${a.kind}\`] **${a.title}** — turn ${a.turnIndex}${a.mimeType ? `, ${a.mimeType}` : ""}`);
    }
    lines.push("");
  }
  if (files.length > 0) {
    lines.push(`## Sandbox files (${files.length})`);
    for (const f of files.slice(0, 50)) {
      lines.push(`- \`${f.path}\`${f.isWorkbook ? " (workbook)" : ""}${typeof f.size === "number" ? ` — ${f.size} bytes` : ""}`);
    }
    if (files.length > 50) lines.push(`- … and ${files.length - 50} more`);
    lines.push("");
  }
  if (questions.length > 0) {
    lines.push(`## HITL questions (${questions.length})`);
    for (const q of questions) {
      lines.push(`- **[${q.status}]** ${q.question}${q.answer ? ` → ${q.answer}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function collapseMessages(events) {
  // message_delta events carry cumulative state, keyed by responseId.
  const byKey = new Map();
  for (const e of events) {
    if (e.kind !== "message_delta") continue;
    const p = e.payload ?? {};
    const key = p.responseId ?? e._id;
    byKey.set(key, {
      text: typeof p.text === "string" ? p.text : "",
      thinking: typeof p.thinking === "string" ? p.thinking : "",
    });
  }
  return [...byKey.values()];
}

function collectToolCalls(events) {
  const byCallId = new Map();
  const out = [];
  for (const e of events) {
    if (e.kind === "tool_start") {
      const p = e.payload ?? {};
      const entry = {
        toolName: p.toolName ?? "tool",
        args: p.args,
        output: "",
        isError: false,
      };
      byCallId.set(p.toolCallId, entry);
      out.push(entry);
    } else if (e.kind === "tool_end") {
      const p = e.payload ?? {};
      const entry = byCallId.get(p.toolCallId);
      if (entry) {
        entry.output = p.output;
        entry.isError = Boolean(p.isError);
      } else {
        out.push({
          toolName: p.toolName ?? "tool",
          args: undefined,
          output: p.output,
          isError: Boolean(p.isError),
        });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// `workbook session list`  (wb-xf44.1)
// ─────────────────────────────────────────────────────────────────

async function runSessionList(opts) {
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const u = new URL(`${DEFAULT_BROKER}/v1/agents/sessions`);
  if (opts.limit) u.searchParams.set("limit", String(opts.limit));
  if (opts.agent) u.searchParams.set("agentSlug", opts.agent);
  if (opts.status) u.searchParams.set("status", opts.status);
  const res = await fetch(u.toString(), {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `workbook session list: broker returned ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const data = JSON.parse(text);
  if (opts.json) {
    process.stdout.write(JSON.stringify(data) + "\n");
    return;
  }
  const rows = Array.isArray(data.sessions) ? data.sessions : [];
  if (rows.length === 0) {
    process.stdout.write("(no sessions)\n");
    return;
  }
  const now = Date.now();
  const lines = rows.map((s) => {
    const id = String(s.id).slice(0, 16);
    const slug = (s.agentSlug ?? "?").padEnd(28).slice(0, 28);
    const status = colorStatus(s.status);
    const age = humanAge(now - (s.updatedAt ?? s.startedAt ?? now));
    const prompt = (s.firstPrompt ?? "").replace(/\s+/g, " ").slice(0, 80);
    return `${id}  ${slug}  ${status}  ${age.padStart(6)}  ${prompt}`;
  });
  process.stdout.write(lines.join("\n") + "\n");
}

function colorStatus(s) {
  const pad = (s ?? "?").padEnd(9).slice(0, 9);
  if (process.stdout.isTTY) {
    if (s === "done") return `\x1b[32m${pad}\x1b[0m`;
    if (s === "running") return `\x1b[33m${pad}\x1b[0m`;
    if (s === "error" || s === "cancelled") return `\x1b[31m${pad}\x1b[0m`;
  }
  return pad;
}

function humanAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ─────────────────────────────────────────────────────────────────
// `workbook session log` (wb-xf44.2) — placeholder until broker
// route ships. Falls back to a clear "endpoint not available yet"
// error so the CLI surface is discoverable even before the server
// piece lands.
// ─────────────────────────────────────────────────────────────────

async function runSessionLog(opts) {
  const id = opts._?.[0];
  if (!id) {
    throw new Error(
      "workbook session log: missing <id>\n  workbook session log <id> [--tail N] [--follow]",
    );
  }
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const tail = opts.tail ?? "";
  const follow = opts.follow === true;
  while (true) {
    const u = new URL(
      `${DEFAULT_BROKER}/v1/agents/sessions/${encodeURIComponent(id)}/log`,
    );
    if (tail) u.searchParams.set("tail", String(tail));
    const res = await fetch(u.toString(), {
      headers: { authorization: `Bearer ${bearer}` },
    });
    const text = await res.text();
    if (res.status === 404) {
      process.stderr.write(
        "workbook session log: endpoint not deployed yet (wb-xf44.2 in progress)\n",
      );
      process.exit(2);
    }
    if (!res.ok) {
      throw new Error(
        `workbook session log: ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const data = JSON.parse(text);
    if (opts.json) {
      process.stdout.write(JSON.stringify(data) + "\n");
    } else {
      const log = data.log ?? "";
      if (log.length > 0) {
        process.stdout.write(log + "\n");
      } else if (!follow) {
        const status = data.sessionStatus ?? "?";
        const note = data.note ? `\n  ${data.note}` : "";
        process.stderr.write(
          `(no log available — session status: ${status}, alive: ${data.alive})${note}\n`,
        );
      }
      if (data.procs) process.stdout.write("---procs---\n" + data.procs + "\n");
    }
    if (!follow) return;
    if (data.alive === false) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ─────────────────────────────────────────────────────────────────
// `workbook session cancel`  (wb-xf44.3)
// ─────────────────────────────────────────────────────────────────

async function runSessionCancel(opts) {
  const id = opts._?.[0];
  if (!id) {
    throw new Error(
      "workbook session cancel: missing <id>\n  workbook session cancel <id> [--json]",
    );
  }
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const res = await fetch(
    `${DEFAULT_BROKER}/v1/agents/sessions/${encodeURIComponent(id)}/cancel`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `workbook session cancel: broker returned ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const data = JSON.parse(text);
  if (opts.json) {
    process.stdout.write(JSON.stringify(data) + "\n");
    return;
  }
  const status = data.status ?? "?";
  const detail = data.statusDetail ? ` (${data.statusDetail})` : "";
  process.stdout.write(`session ${id} → ${status}${detail}\n`);
}

// ─────────────────────────────────────────────────────────────────
// `workbook session inspect`  (wb-xf44.8)
//
// One-shot debug dump: session metadata + last events + error events
// + runner log tail + heuristic "what to try next" hints. Combines
// /export and /log; no new server endpoint.
// ─────────────────────────────────────────────────────────────────

async function runSessionInspect(opts) {
  const id = opts._?.[0];
  if (!id) {
    throw new Error(
      "workbook session inspect: missing <id>\n  workbook session inspect <id> [--json]",
    );
  }
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });

  // Pull session bundle + log in parallel.
  const [bundleRes, logRes] = await Promise.all([
    fetch(
      `${DEFAULT_BROKER}/v1/agents/sessions/${encodeURIComponent(id)}/export`,
      { headers: { authorization: `Bearer ${bearer}` } },
    ),
    fetch(`${DEFAULT_BROKER}/v1/agents/sessions/${encodeURIComponent(id)}/log`, {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  ]);
  if (!bundleRes.ok) {
    const t = await bundleRes.text();
    throw new Error(
      `workbook session inspect: broker returned ${bundleRes.status}: ${t.slice(0, 200)}`,
    );
  }
  const bundle = await bundleRes.json();
  const logData = logRes.ok ? await logRes.json() : null;
  const diagnosis = diagnose(bundle, logData);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ kind: "session.inspect", bundle, log: logData, diagnosis }) + "\n",
    );
    return;
  }

  const lines = [];
  const s = bundle.session ?? {};
  const events = Array.isArray(bundle.events) ? bundle.events : [];
  const errors = events.filter((e) => e.kind === "error");
  const tools = events.filter((e) => e.kind === "tool_start");
  const dx = (logData?.alive === true ? "alive" : "dead/paused");
  lines.push(`SESSION ${s._id ?? id}`);
  lines.push(`  agent:     ${s.agentId ?? "?"}`);
  lines.push(`  model:     ${s.model ?? "?"}`);
  lines.push(
    `  status:    ${s.status ?? "?"}${s.statusDetail ? ` (${s.statusDetail})` : ""}`,
  );
  if (s.sandboxId) {
    lines.push(`  sandbox:   ${s.sandbox ?? "?"}:${s.sandboxId} [${dx}]`);
  }
  const startedAt = s.startedAt ?? s._creationTime ?? null;
  if (startedAt) {
    lines.push(`  age:       ${humanAge(Date.now() - startedAt)}`);
  }
  lines.push(
    `  events:    ${events.length} total | ${tools.length} tools, ${errors.length} errors`,
  );

  if (errors.length > 0) {
    lines.push("");
    lines.push(`ERRORS (${errors.length}):`);
    for (const e of errors.slice(0, 5)) {
      const msg = e.payload?.message ?? JSON.stringify(e.payload ?? {});
      const phase = e.payload?.phase ? `[${e.payload.phase}] ` : "";
      lines.push(`  - ${phase}${(msg ?? "").slice(0, 240)}`);
    }
  }

  const recent = events.slice(-6);
  if (recent.length > 0) {
    lines.push("");
    lines.push("LAST EVENTS:");
    for (const e of recent) {
      lines.push("  " + formatEventOneLine(e));
    }
  }

  if (logData && (logData.log || logData.note)) {
    lines.push("");
    lines.push(`RUNNER LOG (${dx}):`);
    if (logData.log) {
      const tail = logData.log
        .split("\n")
        .filter(Boolean)
        .slice(-12)
        .map((l) => "  " + l)
        .join("\n");
      lines.push(tail);
    } else if (logData.note) {
      lines.push(`  (${logData.note})`);
    }
  }

  if (diagnosis.length > 0) {
    lines.push("");
    lines.push("DIAGNOSIS:");
    for (const d of diagnosis) {
      lines.push(`  • ${d}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

function formatEventOneLine(e) {
  const ts = e.ts ? new Date(e.ts).toISOString().slice(11, 19) : "??:??:??";
  const k = (e.kind ?? "?").padEnd(14).slice(0, 14);
  const p = e.payload ?? {};
  let summary = "";
  if (e.kind === "tool_start") summary = `${p.toolName ?? "?"} ${JSON.stringify(p.args ?? {}).slice(0, 60)}`;
  else if (e.kind === "tool_end")
    summary = `${p.toolName ?? "?"} ${p.isError ? "❌" : "✓"} ${String(p.output ?? "").replace(/\s+/g, " ").slice(0, 60)}`;
  else if (e.kind === "message_delta")
    summary = `"${(p.text ?? "").replace(/\s+/g, " ").slice(0, 80)}"`;
  else if (e.kind === "error") summary = `${p.message ?? JSON.stringify(p).slice(0, 80)}`;
  else if (e.kind === "diagnostic") summary = `${p.name ?? ""} ${JSON.stringify(p).slice(0, 80)}`;
  else if (e.kind === "block") summary = `block ${p.block?.kind ?? "?"}`;
  else summary = JSON.stringify(p).slice(0, 80);
  return `${ts}  ${k}  ${summary}`;
}

/* Heuristic-based diagnosis. Patterns based on the failures we've
 * seen during dev (sandbox-side hangs, MCP misconfig, IP-mismatch,
 * proxy hangs, missing broker URL). Empty array when nothing
 * applies — let the user read the data and reach their own
 * conclusion. */
function diagnose(bundle, logData) {
  const out = [];
  const s = bundle.session ?? {};
  const events = Array.isArray(bundle.events) ? bundle.events : [];
  const errors = events.filter((e) => e.kind === "error");
  const logText = logData?.log ?? "";

  if (s.status === "running" && events.length === 0) {
    out.push(
      "0 events for a still-running session — runner died before postEvent fired. " +
        "Common causes: missing WORKBOOKS_BROKER_URL on Convex (mint capability fails silently), " +
        "or a top-level await inside a bundled dep hanging boot.",
    );
  }
  if (s.status === "error" && s.statusDetail === "sandbox_timeout") {
    out.push(
      "Session marked sandbox_timeout — the runner process was alive but didn't finish in time. " +
        "Pull the runner log with `workbook session log <id>` to see what it was doing.",
    );
  }
  if (logText.includes("workgroup mcp bind failed")) {
    out.push(
      "A workgroup MCP backend is returning 500 on tools/list. The agent boots without those tools — " +
        "if it needs them, fix the MCP host or unshare the group from this agent.",
    );
  }
  if (logText.includes("auth timed out after 5m")) {
    out.push(
      "CLI fell back to loopback OAuth in headless sandbox — WORKBOOKS_BEARER wasn't set. " +
        "Convex's runtime must mint a capability + pass it to the sandbox. Check that " +
        "WORKBOOKS_BROKER_URL is set on the Convex deployment.",
    );
  }
  if (errors.some((e) => /capability_ip_mismatch/.test(e.payload?.message ?? ""))) {
    out.push(
      "Capability IP-mismatch — token was first used from a different IP than this call. " +
        "Most often this means a long-running session crossed sandbox egress IPs; restart it.",
    );
  }
  if (logData?.alive === false && s.status === "running") {
    out.push(
      "Session status is `running` but sandbox is gone. Likely killed externally (E2B pause / OOM). " +
        "Run `workbook session cancel <id>` to mark it cancelled and free the row.",
    );
  }
  return out;
}
