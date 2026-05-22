// Two reporters: tap-ish console + ndjson.
//
// Console output is intentionally TAP-shaped so external tooling
// (CI summarizers, etc.) can ingest it without a custom parser.

export function consoleReporter(out = process.stdout) {
  let checkNumber = 0;
  let passed = 0;
  let failed = 0;
  return {
    suiteStart(specs) {
      out.write(`# eval suite: ${specs.length} spec${specs.length === 1 ? "" : "s"}\n`);
    },
    evalStart(spec) {
      out.write(`# ${spec.name}  [${spec.agent}]  (${rel(spec.sourcePath)})\n`);
    },
    turnStart(_spec, turnIdx, turn) {
      if (!turn.prompt) { out.write(`#   turn ${turnIdx + 1}: (check-only)\n`); return; }
      const preview = turn.prompt.replace(/\s+/g, " ").trim().slice(0, 80);
      out.write(`#   turn ${turnIdx + 1}: ${preview}${turn.prompt.length > 80 ? "…" : ""}\n`);
    },
    check(_spec, _turnIdx, check, result) {
      checkNumber++;
      const summary = `${check.kind}${formatCheckParams(check)}`;
      if (result.ok) {
        passed++;
        const skipTag = result.skipped
          ? (result.reason === "gated" ? " # GATED" : " # SKIP")
          : "";
        out.write(`ok ${checkNumber} — ${summary}${skipTag}\n`);
        if (result.skipped && result.message) {
          out.write(`  # ${result.message}\n`);
        }
      } else {
        failed++;
        out.write(`not ok ${checkNumber} — ${summary}\n`);
        if (result.message) out.write(`  # ${result.message}\n`);
        if (result.detail) {
          for (const [k, v] of Object.entries(result.detail)) {
            out.write(`  # ${k}: ${String(v).slice(0, 200)}\n`);
          }
        }
      }
    },
    turnError(_spec, turnIdx, err) {
      failed++;
      out.write(`not ok — turn ${turnIdx + 1} errored: ${err.message ?? err}\n`);
    },
    turnStatusFail(_spec, turnIdx, status) {
      failed++;
      out.write(`not ok — turn ${turnIdx + 1} closed with status "${status}"\n`);
    },
    setup(_spec, action, result) {
      const tag = result.ok ? "·" : "✗";
      out.write(`# setup ${tag} ${action.kind}${result.ok ? "" : ` — ${result.message ?? ""}`}\n`);
    },
    cleanup(_spec, action, result) {
      const tag = result.ok ? "·" : "✗";
      out.write(`# cleanup ${tag} ${action.kind}${result.ok ? "" : ` — ${result.message ?? ""}`}\n`);
    },
    evalEnd(summary) {
      out.write(`# ${summary.spec.name} — ${summary.pass ? "PASS" : "FAIL"}\n\n`);
    },
    runStart(spec, runIdx, k) {
      if (k > 1) out.write(`# ${spec.name}  run ${runIdx + 1}/${k}\n`);
    },
    runEnd(_spec, _runIdx, _k, _summary) { /* covered by evalEnd */ },
    roundStart(roundIdx, k, activeCount, totalCount) {
      if (k <= 1) return;
      const decided = totalCount - activeCount;
      const skipNote = decided > 0 ? `  (${decided} decided, ${activeCount} undecided)` : "";
      out.write(`# === round ${roundIdx + 1}/${k} ===${skipNote}\n`);
    },
    roundEnd(_roundIdx, _k, _states) { /* covered by evalReliability at the end */ },
    evalReliability(spec, rel) {
      if (rel.k <= 1) return;
      const tag = rel.bucket.toUpperCase();
      out.write(`# ${spec.name} — ${rel.passes}/${rel.k} pass  [${tag}]\n\n`);
    },
    suiteEnd(summaries) {
      const passes = summaries.filter((s) => s.pass).length;
      const fails = summaries.length - passes;
      out.write(`1..${checkNumber}\n`);
      out.write(`# specs: ${summaries.length}  pass: ${passes}  fail: ${fails}\n`);
      out.write(`# checks: pass ${passed}  fail ${failed}\n`);
      // Reliability rollup — only meaningful when k>1.
      const reliable = summaries.filter((s) => s.reliability && s.reliability.k > 1);
      if (reliable.length > 0) {
        const buckets = { green: 0, flaky: 0, "flaky-pass": 0, "flaky-fail": 0, red: 0 };
        for (const s of reliable) buckets[s.reliability.bucket] = (buckets[s.reliability.bucket] ?? 0) + 1;
        const parts = [];
        if (buckets.green) parts.push(`green ${buckets.green}`);
        if (buckets["flaky-pass"]) parts.push(`flaky-pass ${buckets["flaky-pass"]}`);
        if (buckets.flaky) parts.push(`flaky ${buckets.flaky}`);
        if (buckets["flaky-fail"]) parts.push(`flaky-fail ${buckets["flaky-fail"]}`);
        if (buckets.red) parts.push(`red ${buckets.red}`);
        out.write(`# reliability (k=${reliable[0].reliability.k}): ${parts.join("  ")}\n`);
      }
    },
  };
}

export function jsonReporter(out = process.stdout) {
  const emit = (obj) => out.write(JSON.stringify(obj) + "\n");
  return {
    suiteStart(specs) { emit({ kind: "suite.start", count: specs.length }); },
    evalStart(spec) { emit({ kind: "eval.start", name: spec.name, agent: spec.agent, source: spec.sourcePath }); },
    turnStart(spec, turnIdx, turn) { emit({ kind: "turn.start", spec: spec.name, turnIdx, prompt: turn.prompt }); },
    check(spec, turnIdx, check, result) {
      emit({ kind: "check", spec: spec.name, turnIdx, check, ok: result.ok, skipped: Boolean(result.skipped), reason: result.reason ?? null, message: result.message ?? null, detail: result.detail ?? null });
    },
    turnError(spec, turnIdx, err) { emit({ kind: "turn.error", spec: spec.name, turnIdx, error: err.message ?? String(err) }); },
    turnStatusFail(spec, turnIdx, status) { emit({ kind: "turn.status_fail", spec: spec.name, turnIdx, status }); },
    setup(spec, action, result) {
      emit({ kind: "setup", spec: spec.name, action, ok: result.ok, message: result.message ?? null });
    },
    cleanup(spec, action, result) {
      emit({ kind: "cleanup", spec: spec.name, action, ok: result.ok, message: result.message ?? null });
    },
    evalEnd(summary) { emit({ kind: "eval.end", name: summary.spec.name, pass: summary.pass, sessionId: summary.sessionId }); },
    runStart(spec, runIdx, k) { emit({ kind: "run.start", spec: spec.name, runIdx, k }); },
    runEnd(spec, runIdx, k, summary) { emit({ kind: "run.end", spec: spec.name, runIdx, k, pass: summary.pass, sessionId: summary.sessionId }); },
    roundStart(roundIdx, k, activeCount, totalCount) {
      emit({ kind: "round.start", roundIdx, k, activeCount, totalCount });
    },
    roundEnd(roundIdx, k, states) {
      emit({
        kind: "round.end",
        roundIdx,
        k,
        decided: states.filter((s) => s.decision !== null).length,
        remaining: states.filter((s) => s.decision === null).length,
      });
    },
    evalReliability(spec, rel) { emit({ kind: "eval.reliability", spec: spec.name, ...rel }); },
    suiteEnd(summaries) {
      emit({
        kind: "suite.end",
        total: summaries.length,
        passed: summaries.filter((s) => s.pass).length,
        failed: summaries.filter((s) => !s.pass).length,
      });
    },
  };
}

function rel(p) {
  try { return p.replace(process.cwd() + "/", ""); } catch { return p; }
}

function formatCheckParams(check) {
  const { kind: _kind, ...rest } = check;
  const keys = Object.keys(rest);
  if (keys.length === 0) return "";
  const s = JSON.stringify(rest);
  return s.length <= 80 ? `  ${s}` : `  ${s.slice(0, 77)}…`;
}
