// session.poll_until — wb-ojss.4 P3.
//
// Polls a wrapped predicate check at a fixed interval until it passes
// or a deadline elapses. The predicate IS a normal check (any kind from
// the registry); poll_until just retries it with a sleep.
//
// Used by push-event fan-out and similar "eventual consistency" specs
// where the assertion is "this becomes true within N seconds" rather
// than "this is true right now."

// Lazy import to break the cycle: poll.mjs is registered by index.mjs,
// and the predicate runs through index.mjs's runCheck.
let _runCheck = null;
async function runCheck(check, ctx) {
  if (!_runCheck) {
    const mod = await import("./index.mjs");
    _runCheck = mod.runCheck;
  }
  return _runCheck(check, ctx);
}

const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_DEADLINE_MS = 30_000;
const MAX_DEADLINE_MS = 10 * 60 * 1000;

export const pollChecks = {
  "session.poll_until": async (ctx, params) => {
    if (!params || typeof params.predicate !== "object" || Array.isArray(params.predicate)) {
      return { ok: false, message: `session.poll_until: requires "predicate" (object with .kind)` };
    }
    if (typeof params.predicate.kind !== "string") {
      return { ok: false, message: `session.poll_until: "predicate.kind" must be a string` };
    }
    const intervalMs = clamp(
      typeof params.interval_ms === "number" ? params.interval_ms : DEFAULT_INTERVAL_MS,
      50, 60_000,
    );
    const deadlineMs = clamp(
      typeof params.deadline_ms === "number" ? params.deadline_ms : DEFAULT_DEADLINE_MS,
      intervalMs, MAX_DEADLINE_MS,
    );

    const startedAt = Date.now();
    const stopAt = startedAt + deadlineMs;
    let lastResult = null;
    let attempts = 0;
    while (Date.now() < stopAt) {
      attempts += 1;
      lastResult = await runCheck(params.predicate, ctx);
      if (lastResult.ok && !lastResult.skipped) {
        const elapsed = Date.now() - startedAt;
        return {
          ok: true,
          message: `poll_until: ${params.predicate.kind} passed after ${attempts} attempt${attempts === 1 ? "" : "s"} (${elapsed}ms)`,
        };
      }
      // skipped → not a hard fail, keep polling (the predicate may need
      // state that hasn't been set yet, e.g. ctx.lastPulledDir)
      if (Date.now() + intervalMs >= stopAt) break;
      await sleep(intervalMs);
    }
    const elapsed = Date.now() - startedAt;
    return {
      ok: false,
      message: `session.poll_until: ${params.predicate.kind} did not pass within ${deadlineMs}ms (${attempts} attempt${attempts === 1 ? "" : "s"}, elapsed ${elapsed}ms)`,
      detail: lastResult ? { last: lastResult.message ?? "(no message)" } : undefined,
    };
  },
};

function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
