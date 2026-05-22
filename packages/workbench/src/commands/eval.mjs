// `workbook eval [pattern]` — discover and run eval specs.
//
// Specs are JSON files matching *.eval.json. Discovery starts from
// the cwd unless [pattern] is provided. If [pattern] points at a
// directory, walk it; if it points at a file, run that one.
//
// Exit codes:
//   0 — all specs passed
//   1 — one or more specs failed
//   2 — usage error / no specs found

import { promises as fs } from "node:fs";
import path from "node:path";

import { discoverSpecs, loadSpec } from "../eval/spec.mjs";
import { runEval } from "../eval/runner.mjs";
import { consoleReporter, jsonReporter } from "../eval/reporter.mjs";

export async function runEvalCmd(opts = {}) {
  const asJson = opts.json === true || opts.format === "json";
  const dry = opts.dry === true;
  const keep = opts.keep === true;
  const filter = typeof opts.filter === "string" ? opts.filter : null;
  // EVAL_PRINCIPLES.md #5 — pass^k reliability metric. Each spec runs
  // k times; spec is GREEN only if k of k pass (strict) or pass-rate
  // exceeds --pass-threshold (lenient). Default k=1 for backward
  // compatibility with single-run smoke; flip to 3+ for honest
  // reliability assessment.
  const passK = Math.max(1, Math.floor(Number(opts["pass-k"] ?? opts.k ?? 1)));
  const passThreshold = typeof opts["pass-threshold"] === "string"
    ? Number(opts["pass-threshold"])
    : null;
  // wb-xpgr.4.5 — promote soft-skipped checks (auth.* boundary tests
  // missing config knobs, etc.) to hard fails. Default off so local
  // iteration stays ergonomic; intended for CI / pre-release audits
  // where a green spec must mean every assertion actually ran.
  const requireAll = opts["require-all"] === true || opts.requireAll === true;
  // wb-1r3i.4 — override the runtime declared in each spec without
  // mutating the spec file. Useful for migrating a suite to a new
  // runtime ('beam') in stages; only the runtime field is replaced.
  const runtimeOverride = typeof opts.runtime === "string" ? opts.runtime : null;
  const reporter = asJson ? jsonReporter() : consoleReporter();

  const target = opts._?.[0] ?? "evals";
  const files = await resolveTargets(target);

  if (files.length === 0) {
    process.stderr.write(`workbook eval: no *.eval.{json,md} files found at ${target}\n`);
    process.exit(2);
  }

  let specs = [];
  for (const f of files) {
    const spec = await loadSpec(f);
    if (runtimeOverride) {
      // Top-level runtime + every session-level runtime get the same
      // override. Specs that pin per-session runtimes can still opt
      // out of the override by setting them explicitly (this clobbers
      // them by design — caller said --runtime=foo on purpose).
      spec.runtime = runtimeOverride;
      if (Array.isArray(spec.sessions)) {
        spec.sessions = spec.sessions.map((s) => ({ ...s, runtime: runtimeOverride }));
      }
    }
    specs.push(spec);
  }
  if (filter) {
    const before = specs.length;
    specs = specs.filter((s) => s.name.includes(filter) || s.sourcePath.includes(filter));
    if (specs.length === 0) {
      process.stderr.write(`workbook eval: --filter ${JSON.stringify(filter)} matched 0 of ${before} specs\n`);
      process.exit(2);
    }
  }

  if (dry) {
    printDryPlan(specs, asJson);
    process.exit(0);
  }

  reporter.suiteStart(specs);

  // Round-based execution. Each round runs every UNDECIDED spec once;
  // specs that have already met (or can no longer meet) the pass
  // criterion are skipped on subsequent rounds. With default passK=1
  // there's exactly one round, so behavior is identical to the old
  // per-spec inner loop. With passK > 1 we stop burning runs on specs
  // that are already green (or already doomed in strict mode).
  if (keep) {
    // --keep: pre-empt cleanup so substrate artifacts stay on disk for
    // human inspection. Set once across all rounds.
    for (const spec of specs) spec.cleanup = [];
  }

  const states = specs.map((spec) => ({ spec, runs: [], decision: null }));
  for (let round = 0; round < passK; round++) {
    const active = states.filter((s) => s.decision === null);
    if (active.length === 0) break;
    reporter?.roundStart?.(round, passK, active.length, states.length);
    for (const s of active) {
      reporter?.runStart?.(s.spec, s.runs.length, passK);
      const summary = await runEval(s.spec, { reporter, keepClone: keep, requireAll });
      s.runs.push(summary);
      reporter?.runEnd?.(s.spec, s.runs.length - 1, passK, summary);
      if (keep && summary.keptClonePath) {
        process.stderr.write(`# kept substrate clone (run ${s.runs.length}): ${summary.keptClonePath}\n`);
      }
      s.decision = decideAfter(s.runs, passK, passThreshold);
    }
    reporter?.roundEnd?.(round, passK, states);
  }

  const summaries = states.map((s) => {
    const reliability = aggregateRuns(s.runs, passThreshold);
    reporter?.evalReliability?.(s.spec, reliability);
    return {
      spec: s.spec,
      pass: reliability.pass,
      runs: s.runs,
      reliability,
      // Surface the last sessionId so downstream tooling (workbook-observe)
      // has something to query.
      sessionId: s.runs.at(-1)?.sessionId ?? null,
    };
  });
  reporter.suiteEnd(summaries);

  const anyFail = summaries.some((s) => !s.pass);
  process.exit(anyFail ? 1 : 0);
}

// Per-spec decision after `runs.length` of `k` total runs have completed.
// Returns "pass" once the spec has met the pass criterion (no further
// runs would change the outcome), "fail" once it can no longer meet it,
// or null if the spec needs another round.
//
//   strict (no threshold): green only if k of k pass. One failure
//     means it can never be green — decide FAIL early. k passes means
//     decide PASS.
//   lenient (threshold T): decide PASS once passes/k >= T (a bad run
//     left can't unmake that). Decide FAIL once (passes + remaining)/k
//     < T (no number of remaining wins can push us over).
export function decideAfter(runs, k, threshold) {
  const completed = runs.length;
  const passes = runs.filter((r) => r.pass).length;
  const fails = completed - passes;
  const remaining = k - completed;
  if (threshold != null && !Number.isNaN(threshold)) {
    if (passes / k >= threshold) return "pass";
    if ((passes + remaining) / k < threshold) return "fail";
    return null;
  }
  if (fails > 0) return "fail";
  if (passes === k) return "pass";
  return null;
}

function aggregateRuns(runs, passThreshold) {
  const k = runs.length;
  const passes = runs.filter((r) => r.pass).length;
  const fails = k - passes;
  // Strict by default: GREEN only if k of k. Lenient if a threshold
  // was specified.
  let pass;
  let bucket;
  if (passThreshold != null && !Number.isNaN(passThreshold)) {
    pass = (passes / k) >= passThreshold;
    bucket = passes === k ? "green" : (passes === 0 ? "red" : (pass ? "flaky-pass" : "flaky-fail"));
  } else {
    pass = passes === k;
    bucket = passes === k ? "green" : (passes === 0 ? "red" : "flaky");
  }
  return { k, passes, fails, pass, bucket, threshold: passThreshold ?? null };
}

function printDryPlan(specs, asJson) {
  if (asJson) {
    for (const s of specs) {
      process.stdout.write(JSON.stringify({ kind: "plan", spec: s }) + "\n");
    }
    return;
  }
  for (const s of specs) {
    const agentLabel = s.sessions
      ? s.sessions.map((x) => `${x.id}:${x.agent}`).join(", ")
      : s.agent;
    process.stdout.write(`# ${s.name}  [${agentLabel}]${s.resume ? "  (resume)" : ""}\n`);
    process.stdout.write(`  source: ${s.sourcePath}\n`);
    if (s.setup?.length) {
      process.stdout.write(`  setup: ${s.setup.length} action${s.setup.length === 1 ? "" : "s"}\n`);
      for (const a of s.setup) process.stdout.write(`    action: ${a.kind}\n`);
    }
    for (let i = 0; i < s.turns.length; i++) {
      const t = s.turns[i];
      const sessSuffix = t.session ? `  {${t.session}${t.after ? ` after ${t.after.sessionId}.turn.${t.after.turnIdx}` : ""}}` : "";
      if (t.prompt) {
        const preview = t.prompt.replace(/\s+/g, " ").trim().slice(0, 80);
        process.stdout.write(`  turn ${i + 1}${sessSuffix}: ${preview}${t.prompt.length > 80 ? "…" : ""}\n`);
      } else if (t.action) {
        process.stdout.write(`  turn ${i + 1}${sessSuffix}: (action: ${t.action.kind})\n`);
      } else {
        process.stdout.write(`  turn ${i + 1}${sessSuffix}: (check-only)\n`);
      }
      for (const c of t.checks) {
        process.stdout.write(`    check: ${c.kind}\n`);
      }
    }
    if (s.cleanup.length) {
      process.stdout.write(`  cleanup: ${s.cleanup.length} action${s.cleanup.length === 1 ? "" : "s"}\n`);
      for (const c of s.cleanup) {
        process.stdout.write(`    action: ${c.kind}\n`);
      }
    }
    process.stdout.write("\n");
  }
}

async function resolveTargets(target) {
  const abs = path.resolve(target);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  if (stat.isDirectory()) {
    return discoverSpecs(abs);
  }
  if (stat.isFile() && (abs.endsWith(".eval.json") || abs.endsWith(".eval.md"))) {
    return [abs];
  }
  throw new Error(`workbook eval: target ${target} is neither a directory nor a *.eval.{json,md} file`);
}
