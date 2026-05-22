// `workbook improve <spec-path>` — Phase C of wb-xpgr.
//
// Runs ONE failing spec, feeds the failure context (judge verdict,
// trace summary, agent source) to an improver agent (workhorse +
// objective-thinking discipline), prints the proposed diff against
// the agent's manifest source.
//
// Iteration 1: propose-only. Human reviews + applies. Iteration 2
// (future): --auto applies + re-runs + loops + two-pass critic.

import { loadSpec } from "../eval/spec.mjs";
import { runEval } from "../eval/runner.mjs";
import { improveFailingSpecs } from "../eval/improve.mjs";
import { consoleReporter } from "../eval/reporter.mjs";

export async function runImprove(opts = {}) {
  const target = opts._?.[0];
  if (!target) {
    throw new Error(
      "workbook improve <spec-path>\n" +
        "  Runs the spec once, and if it fails, dispatches an improver\n" +
        "  agent that proposes a diff against the failing agent's manifest.\n" +
        "  The diff is printed for human review; nothing is applied.",
    );
  }

  const spec = await loadSpec(target);
  const reporter = consoleReporter();

  process.stdout.write(`# improve: running spec once to capture failure context\n\n`);
  reporter.suiteStart([spec]);
  const summary = await runEval(spec, { reporter });
  reporter.suiteEnd([summary]);

  if (summary.pass) {
    process.stdout.write(`\n# improve: spec passed; nothing to improve\n`);
    return;
  }

  // Match the shape improveFailingSpecs expects (pass^k-flavored summary).
  const aggregated = {
    spec,
    pass: false,
    runs: [summary],
    reliability: { k: 1, passes: 0, fails: 1, pass: false, bucket: "red" },
    sessionId: summary.sessionId,
    turnResults: summary.turnResults,
  };
  // improveFailingSpecs looks at turnResults on the failed run, so
  // surface it via the runs[] entry too.
  aggregated.runs[0].turnResults = summary.turnResults;

  await improveFailingSpecs([aggregated], {
    auto: opts.auto === true,
    passK: typeof opts["pass-k"] === "string" ? Math.max(1, Number(opts["pass-k"])) : 3,
  });
}
