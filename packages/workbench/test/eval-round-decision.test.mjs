#!/usr/bin/env node
// Lock the round-based runner's per-spec early-exit rules. The runner
// (src/commands/eval.mjs) skips specs that have already been decided
// (PASS or FAIL); decideAfter is the predicate that says when.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const evalCmdPath = path.resolve(here, "..", "src", "commands", "eval.mjs");

// Import the helper via a tiny in-process shim. decideAfter is not
// exported today, so re-export it from a sibling temp module... instead
// of doing that gymnastics, copy the rule and exercise it against the
// same shapes used by the runner. The two must stay in sync — if this
// drifts, the round-based runner will run the wrong number of rounds.
async function importDecideAfter() {
  const mod = await import(evalCmdPath);
  if (typeof mod.decideAfter === "function") return mod.decideAfter;
  throw new Error("decideAfter not exported from src/commands/eval.mjs");
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++; else fail++;
}
function runs(...flags) { return flags.map((p) => ({ pass: !!p })); }

const decideAfter = await importDecideAfter();

// strict (no threshold)
check("strict: 0/3 undecided", decideAfter(runs(), 3, null) === null);
check("strict: 1 pass of 3 undecided", decideAfter(runs(true), 3, null) === null);
check("strict: 1 fail of 3 → FAIL early", decideAfter(runs(false), 3, null) === "fail");
check("strict: 2 passes 0 fails of 3 → still undecided", decideAfter(runs(true, true), 3, null) === null);
check("strict: 3 of 3 pass → PASS", decideAfter(runs(true, true, true), 3, null) === "pass");
check("strict: 2 pass 1 fail at end → FAIL", decideAfter(runs(true, true, false), 3, null) === "fail");

// lenient (threshold 0.66) — k=3, need at least 2 of 3 to pass
check("lenient T=0.66: 0/3 undecided", decideAfter(runs(), 3, 0.66) === null);
check("lenient T=0.66: 2 passes 0 fails → PASS early (2/3=0.66)", decideAfter(runs(true, true), 3, 0.66) === "pass");
check("lenient T=0.66: 1 pass 1 fail → undecided (best 2/3, worst 1/3)", decideAfter(runs(true, false), 3, 0.66) === null);
check("lenient T=0.66: 0 passes 2 fails → FAIL (best 1/3 < 0.66)", decideAfter(runs(false, false), 3, 0.66) === "fail");
check("lenient T=0.66: 1 pass 2 fails at end → FAIL", decideAfter(runs(true, false, false), 3, 0.66) === "fail");

// lenient T=1.0 collapses to strict
check("lenient T=1.0: 1 fail of 3 → FAIL", decideAfter(runs(false), 3, 1.0) === "fail");
check("lenient T=1.0: 3/3 pass → PASS", decideAfter(runs(true, true, true), 3, 1.0) === "pass");

// k=1 — always decided after the single run
check("k=1 strict: 1 pass → PASS", decideAfter(runs(true), 1, null) === "pass");
check("k=1 strict: 1 fail → FAIL", decideAfter(runs(false), 1, null) === "fail");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
