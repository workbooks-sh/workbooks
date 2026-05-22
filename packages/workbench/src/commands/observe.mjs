// `workbook session observe <id>` — render an aggregated, opinionated
// view of a session: what happened, what cost what, what failed and
// why. Operator-first; same data the future Studio Observability pane
// will consume.
//
// Foundational principle: every "weird" event shape today
// (agent_end null-stopReason, postEvent 401, model 402) should appear
// here with a categorized name. No more "grep raw events to figure
// out what went wrong."

import { spawn } from "node:child_process";

import { aggregate } from "../observe/aggregate.mjs";
import { bundleToOTLP } from "../observe/otel.mjs";
import { spawnArgsForWorkbook } from "../util/workbook-bin.mjs";

export async function runObserve(opts = {}) {
  const sessionId = opts._?.[0] ?? opts.id;
  if (!sessionId) {
    throw new Error(
      "workbook session observe <session-id>\n" +
        "  --json           emit the aggregated summary as JSON\n" +
        "  --raw            include the raw bundle alongside the summary",
    );
  }
  const asJson = opts.json === true || opts.format === "json";
  const asOtel = opts.format === "otel";

  const bundle = await fetchBundle(sessionId);

  if (asOtel) {
    // Emit OTLP-HTTP JSON envelope. Pipe directly to Phoenix:
    //   workbook-observe <id> --format=otel | curl -sX POST \
    //     http://localhost:6006/v1/traces \
    //     -H 'Content-Type: application/json' --data-binary @-
    const payload = bundleToOTLP(bundle);
    process.stdout.write(JSON.stringify(payload));
    return;
  }

  const view = aggregate(bundle);

  if (asJson) {
    process.stdout.write(JSON.stringify(view, null, 2) + "\n");
    return;
  }
  renderConsole(view);
}

async function fetchBundle(sessionId) {
  return new Promise((resolve, reject) => {
    const [spawnCmd, spawnArgs] = spawnArgsForWorkbook(["session", sessionId, "--format=json"]);
    const child = spawn(
      spawnCmd,
      spawnArgs,
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`workbook session ${sessionId} exited ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch (err) { reject(new Error(`session export not JSON: ${err.message}`)); }
    });
  });
}

function renderConsole(v) {
  const out = process.stdout;
  const s = v.summary;
  const dim = "\x1b[2m"; const reset = "\x1b[0m";
  const bold = "\x1b[1m"; const green = "\x1b[32m"; const red = "\x1b[31m";
  const yellow = "\x1b[33m"; const cyan = "\x1b[36m";

  out.write(`\n${bold}session ${s.sessionId}${reset}\n`);
  out.write(`${dim}status${reset}   ${statusBadge(s.status)} ${s.statusDetail ? dim + s.statusDetail.slice(0, 80) + reset : ""}\n`);
  out.write(`${dim}runtime${reset}  ${s.runtime.target ?? "?"} → ${s.runtime.adapter ?? "?"} ${dim}(${(s.runtime.reason ?? "").slice(0, 60)})${reset}\n`);
  out.write(`${dim}model${reset}    ${s.model ?? "?"}\n`);
  out.write(`${dim}timing${reset}   ${formatDuration(s.timing.durationMs)} ${dim}(${formatTs(s.timing.startedAt)} → ${formatTs(s.timing.completedAt)})${reset}\n`);

  out.write(`\n${bold}tokens${reset}\n`);
  if (s.tokens.totalCalls === 0) {
    out.write(`  ${dim}no model calls observed${reset}\n`);
  } else if (s.tokens.unreportedCalls === s.tokens.totalCalls) {
    out.write(`  ${yellow}all ${s.tokens.totalCalls} call(s) unreported usage${reset} ${dim}— upstream may have errored, or pi-agent-core didn't surface usage${reset}\n`);
  } else {
    out.write(`  input ${s.tokens.input}  output ${s.tokens.output}  cacheR ${s.tokens.cacheRead}  cacheW ${s.tokens.cacheWrite}\n`);
    if (s.tokens.costUsd > 0) out.write(`  cost  ${green}$${s.tokens.costUsd.toFixed(4)}${reset}\n`);
    if (s.tokens.unreportedCalls > 0) {
      out.write(`  ${dim}note: ${s.tokens.unreportedCalls}/${s.tokens.totalCalls} call(s) had no usage reported${reset}\n`);
    }
  }

  out.write(`\n${bold}turns${reset}  ${dim}(${v.turns.length})${reset}\n`);
  for (const t of v.turns) {
    const status = t.status === "completed" || t.status === "done" ? green + "✓" : t.status === "error" ? red + "✗" : yellow + "·";
    out.write(`  ${status}${reset} turn ${t.turnIndex}  ${dim}${formatDuration(t.durationMs)}${reset}\n`);
    out.write(`    ${dim}prompt:${reset} ${t.prompt.replace(/\s+/g, " ").slice(0, 100)}${t.prompt.length > 100 ? "…" : ""}\n`);
    const stats = [];
    stats.push(`${t.assistantChars} chars assistant`);
    if (t.toolCount) stats.push(`${t.toolCount} tools (${t.toolFailures} failed)`);
    if (t.errorCount) stats.push(`${red}${t.errorCount} error${t.errorCount === 1 ? "" : "s"}${reset}`);
    out.write(`    ${dim}${stats.join(" · ")}${reset}\n`);
  }

  out.write(`\n${bold}tool calls${reset}  ${dim}(${v.toolCalls.length})${reset}\n`);
  if (v.toolCalls.length === 0) {
    out.write(`  ${dim}none${reset}\n`);
  } else {
    const tally = new Map();
    for (const t of v.toolCalls) {
      const key = t.toolName;
      const e = tally.get(key) ?? { ok: 0, err: 0, ms: 0 };
      if (t.isError) e.err++; else e.ok++;
      if (t.durationMs) e.ms += t.durationMs;
      tally.set(key, e);
    }
    for (const [name, e] of [...tally.entries()].sort((a, b) => (b[1].ok + b[1].err) - (a[1].ok + a[1].err))) {
      const errStr = e.err > 0 ? `  ${red}${e.err} fail${reset}` : "";
      out.write(`  ${cyan}${name}${reset}  ${e.ok} ok${errStr}  ${dim}${formatDuration(e.ms)} total${reset}\n`);
    }
  }

  out.write(`\n${bold}errors${reset}  ${dim}(${v.errors.length})${reset}\n`);
  if (v.errors.length === 0) {
    out.write(`  ${dim}none classified${reset}\n`);
  } else {
    const grouped = new Map();
    for (const e of v.errors) {
      const k = e.category;
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(e);
    }
    for (const [cat, list] of grouped) {
      out.write(`  ${red}${cat}${reset}  ${dim}×${list.length}${reset}\n`);
      for (const e of list.slice(0, 3)) {
        out.write(`    ${dim}turn ${e.turnIndex ?? "?"} ${e.source}:${reset} ${e.message.slice(0, 120)}\n`);
      }
      if (list.length > 3) out.write(`    ${dim}... ${list.length - 3} more${reset}\n`);
    }
  }

  out.write("\n");
}

function statusBadge(status) {
  if (status === "done" || status === "completed") return "\x1b[32m✓ done\x1b[0m";
  if (status === "error") return "\x1b[31m✗ error\x1b[0m";
  if (status === "cancelled") return "\x1b[33m· cancelled\x1b[0m";
  if (status === "running") return "\x1b[33m· running\x1b[0m";
  return `· ${status}`;
}

function formatDuration(ms) {
  if (ms == null) return "?";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTs(ms) {
  if (!ms) return "?";
  return new Date(ms).toISOString().slice(11, 19);
}
