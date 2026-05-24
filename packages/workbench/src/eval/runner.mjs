// Runs a single eval spec end-to-end against the real broker.
//
// Each turn spawns `workbook chat <agent> "<prompt>" --json [--session <id>]`
// as a subprocess. We dogfood the same CLI surface users script
// against — no shared internal state, no hidden coupling.
//
// wb-ojss.4 P1 — multi-session mode: when the spec declares a
// `sessions:` array each turn carries a `session: <id>` field and
// optionally an `after: <sid>.turn.<n>` cross-session barrier. Sessions
// own independent chat sessionIds (separate broker connections) but
// share the substrate clone — that's the point of two-session-race.
//
// Ordering semantics:
//   - Within a session, turns run sequentially in declaration order.
//   - Across sessions, turns run as concurrently as their `after:`
//     barriers allow. An `after: alpha.turn.0` blocks until alpha's
//     turn 0 has fully completed (chat closed + per-turn checks done).
//   - Independent sessions with no `after:` barriers can interleave
//     freely — runner.mjs starts each session's turn-loop in parallel.

import { spawn } from "node:child_process";

import { runCheck } from "./checks/index.mjs";
import { runAction } from "./actions/index.mjs";
import { SubstrateHandle } from "./substrate.mjs";
import { loadEvalConfig, requireEvalOrg } from "./config.mjs";
import { isGate } from "./tiers.mjs";
import { spawnArgsForWorkbook } from "../util/workbook-bin.mjs";
import { resolveBeamRunner } from "../util/beam-runner.mjs";

const DEFAULT_SESSION_ID = "default";

export async function runEval(spec, opts = {}) {
  const { reporter, abortSignal, keepClone = false, requireAll = false } = opts;
  reporter?.evalStart?.(spec);

  const substrate = makeLazySubstrate(spec);
  const ctxState = {};
  let pass = true;
  let keptClonePath = null;

  const sessions = resolveSessions(spec);
  // Per-session mutable state: chat sessionId, last events, last
  // chatStatus. Each session's checks see ITS OWN events stream (no
  // cross-session leakage of tool_called / text_contains).
  const sessionState = new Map();
  for (const s of sessions) {
    sessionState.set(s.id, { sessionId: null, events: [], chatStatus: null });
  }

  // Ordered turn-result log (across sessions). Each entry: { sessionId,
  // turnIdx, localIdx, checks, chatStatus, error? }. localIdx is the
  // ordinal of this turn WITHIN its session (what `after: <sid>.turn.<n>`
  // refers to).
  const turnResults = [];

  // Cross-session completion barriers — a promise that resolves when
  // `<sessionId>.turn.<localIdx>` is fully done (chat + checks). Other
  // sessions awaiting that turn pull from this map.
  const barriers = new Map();
  function barrierKey(sid, localIdx) { return `${sid}.${localIdx}`; }
  function ensureBarrier(sid, localIdx) {
    const k = barrierKey(sid, localIdx);
    let entry = barriers.get(k);
    if (!entry) {
      let resolveFn;
      let rejectFn;
      const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
      entry = { promise, resolve: resolveFn, reject: rejectFn };
      barriers.set(k, entry);
    }
    return entry;
  }

  /* wb-r62g — default the chat session's org to the eval-config org
   * (workbook.local.json -> eval.org) when the spec doesn't pin one
   * explicitly. */
  let resolvedOrgId = spec.orgId ?? null;
  if (!resolvedOrgId) {
    const cfg = await loadEvalConfig().catch(() => null);
    if (cfg?.org) resolvedOrgId = cfg.org;
  }

  // Per-session view of ctx — substrate is shared, sessionId/events
  // belong to the session being processed. turnIdx is the GLOBAL ordinal
  // (in execution order), localIdx is the per-session ordinal — checks
  // generally don't care which, but the reporter does.
  const makeCtx = (sid, localIdx, globalIdx) => {
    const state = sessionState.get(sid);
    return {
      get events() { return state.events; },
      get sessionId() { return state.sessionId; },
      spec,
      turnIdx: globalIdx,
      localTurnIdx: localIdx,
      sessionRoleId: sid,
      substrate,
      get lastPublishedId() { return ctxState.lastPublishedId; },
      set lastPublishedId(v) { ctxState.lastPublishedId = v; },
      get lastPublishedUrl() { return ctxState.lastPublishedUrl; },
      set lastPublishedUrl(v) { ctxState.lastPublishedUrl = v; },
      get lastPulledDir() { return ctxState.lastPulledDir; },
      set lastPulledDir(v) { ctxState.lastPulledDir = v; },
      get waveletRunDir() { return ctxState.waveletRunDir; },
      set waveletRunDir(v) { ctxState.waveletRunDir = v; },
      get waveletWorkdir() { return ctxState.waveletWorkdir; },
      set waveletWorkdir(v) { ctxState.waveletWorkdir = v; },
      get waveletTrace() { return ctxState.waveletTrace; },
      set waveletTrace(v) { ctxState.waveletTrace = v; },
      get waveletTranscript() { return ctxState.waveletTranscript; },
      set waveletTranscript(v) { ctxState.waveletTranscript = v; },
      get waveletCommercialMp4() { return ctxState.waveletCommercialMp4; },
      set waveletCommercialMp4(v) { ctxState.waveletCommercialMp4 = v; },
    };
  };

  // Setup uses a synthetic single-session ctx — setup runs before any
  // session is opened.
  const setupCtx = makeCtx(sessions[0].id, -1, -1);

  try {
    if (spec.setup?.length) {
      for (const action of spec.setup) {
        const r = await runAction(action, setupCtx);
        reporter?.setup?.(spec, action, r);
        if (!r.ok) {
          pass = false;
          process.stderr.write(`eval: setup ${action.kind} failed: ${r.message ?? "unknown"}\n`);
          reporter?.evalEnd?.({ spec, pass: false, sessionId: null, turnResults });
          return { spec, pass: false, sessionId: null, turnResults };
        }
      }
    }

    // Build per-session turn queues. Each entry includes the global
    // turn index (declaration order in spec.turns) so reporting stays
    // stable across runs.
    const queues = new Map();
    for (const s of sessions) queues.set(s.id, []);
    for (let gi = 0; gi < spec.turns.length; gi++) {
      const t = spec.turns[gi];
      const sid = t.session ?? DEFAULT_SESSION_ID;
      const q = queues.get(sid);
      if (!q) {
        throw new Error(`runner: turn ${gi} references unknown session "${sid}"`);
      }
      q.push({ turn: t, globalIdx: gi, localIdx: q.length });
    }

    // Drive each session concurrently. A session's turn-loop awaits its
    // own previous turn AND any `after:` barrier from other sessions.
    let globalCounter = 0;
    const orderingLock = { value: Promise.resolve() };
    async function runSessionLoop(sessDecl) {
      const queue = queues.get(sessDecl.id) ?? [];
      for (const entry of queue) {
        const { turn, globalIdx, localIdx } = entry;

        if (turn.after) {
          const dep = ensureBarrier(turn.after.sessionId, turn.after.turnIdx);
          try { await dep.promise; }
          catch { /* failure of dependency surfaces via its own turnResults entry */ }
        }

        if (turn.idleBeforeMs > 0) {
          reporter?.idle?.(spec, globalIdx, turn.idleBeforeMs);
          await sleep(turn.idleBeforeMs, abortSignal);
        }

        const turnSlot = { sessionRoleId: sessDecl.id, turnIdx: globalIdx, localIdx, order: globalCounter++ };
        reporter?.turnStart?.(spec, globalIdx, turn);

        const ctx = makeCtx(sessDecl.id, localIdx, globalIdx);
        const state = sessionState.get(sessDecl.id);

        let chatStatus = "done";
        let turnErrored = false;
        if (turn.prompt) {
          try {
            // wb-1r3i.5.X — BEAM runtime needs a workdir so file
            // writes land in the substrate clone the checks read
            // from. Pre-clone the substrate if ANY check in this
            // turn touches substrate.* / workbook.* — otherwise
            // we'd lazy-clone only after the agent runs, missing
            // the chance to materialize agent writes into it.
            const turnRuntime = sessDecl.runtime ?? spec.runtime;
            if (turnRuntime === "beam" && needsSubstrate(turn.checks)) {
              await substrate.ensureClone();
            }
            const workdir = substrate.handle?.cloneDir ?? null;
            const result = await driveChat({
              agent: sessDecl.agent,
              prompt: turn.prompt,
              sessionId: state.sessionId,
              timeoutMs: spec.timeoutMs,
              abortSignal,
              runtime: sessDecl.runtime ?? spec.runtime,
              orgId: resolvedOrgId,
              workdir,
            });
            state.events = result.events;
            state.sessionId = result.sessionId;
            chatStatus = result.status ?? "done";
            state.chatStatus = chatStatus;
          } catch (err) {
            pass = false;
            turnResults.push({ ...turnSlot, error: err.message ?? String(err), checks: [] });
            reporter?.turnError?.(spec, globalIdx, err);
            turnErrored = true;
            ensureBarrier(sessDecl.id, localIdx).resolve();
            continue;
          }
        } else if (turn.action) {
          state.events = [];
          const actionResult = await runAction(turn.action, ctx);
          reporter?.setup?.(spec, turn.action, actionResult);
          if (!actionResult.ok) {
            pass = false;
            turnResults.push({
              ...turnSlot,
              error: `turn.action ${turn.action.kind} failed: ${actionResult.message ?? "unknown"}`,
              checks: [],
            });
            reporter?.turnError?.(spec, globalIdx, new Error(actionResult.message ?? "action failed"));
            turnErrored = true;
            ensureBarrier(sessDecl.id, localIdx).resolve();
            continue;
          }
        } else {
          state.events = [];
        }

        // Serialize check execution across sessions to keep the existing
        // reporter contract — the reporter is single-stream and would
        // interleave confusingly otherwise. Within a turn, checks run
        // sequentially as before. Sessions still progress concurrently
        // OUTSIDE this lock (the chat/idle/action call happens
        // in parallel; only the check phase is serialized).
        const prev = orderingLock.value;
        let releaseLock;
        orderingLock.value = new Promise((r) => { releaseLock = r; });
        await prev;

        let checkResults;
        try {
          checkResults = await runChecksForTurn({
            spec, turn, globalIdx, ctx, reporter, requireAll,
          });
        } finally {
          releaseLock();
        }

        const turnFailed = checkResults.some((c) => !c.result.ok && !c.result.skipped);
        if (turnFailed) pass = false;
        // "declined" is a structured refusal — the agent intentionally
        // ended the turn because the request was out of scope. Specs
        // testing decline behavior pass on declined; specs expecting
        // completion fail (their gates will catch it). Don't treat
        // declined as an automatic turn-level failure.
        if (chatStatus && chatStatus !== "done" && chatStatus !== "declined") {
          pass = false;
          reporter?.turnStatusFail?.(spec, globalIdx, chatStatus);
        }

        turnResults.push({ ...turnSlot, checks: checkResults, chatStatus });
        ensureBarrier(sessDecl.id, localIdx).resolve();
        if (turnErrored) { /* unreachable: continue earlier */ }
      }
    }

    await Promise.all(sessions.map(runSessionLoop));

    if (spec.cleanup?.length) {
      for (const action of spec.cleanup) {
        const r = await runAction(action, setupCtx);
        reporter?.cleanup?.(spec, action, r);
        if (!r.ok) {
          process.stderr.write(`eval: cleanup ${action.kind} failed: ${r.message ?? "unknown"}\n`);
        }
      }
    }
  } finally {
    if (substrate.handle) {
      if (keepClone) {
        keptClonePath = substrate.handle.cloneDir;
      } else {
        await substrate.handle.dispose();
      }
    }
  }

  // Sort by execution order so downstream summary stays stable.
  turnResults.sort((a, b) => a.order - b.order);

  // Surface the "primary" sessionId — the first session's, or for
  // single-session specs the only one. Downstream tooling (workbook
  // observe) expects this.
  const primarySessionId = sessionState.get(sessions[0].id)?.sessionId ?? null;
  const summary = { spec, pass, sessionId: primarySessionId, turnResults, keptClonePath };
  reporter?.evalEnd?.(summary);
  return summary;
}

// EVAL_PRINCIPLES.md #2 — gates first; rubrics only after all gates
// pass. Extracted so multi-session loop can call it the same way the
// single-session path always has.
async function runChecksForTurn({ spec, turn, globalIdx, ctx, reporter, requireAll }) {
  const checkResults = [];
  const gates = turn.checks.filter(isGate);
  const rubrics = turn.checks.filter((c) => !isGate(c));
  let allGatesPassed = true;
  for (const check of gates) {
    const r = await runCheck(check, ctx);
    if (requireAll && r.skipped && r.reason !== "gated") {
      r.ok = false;
      r.skipped = false;
      r.message = `[require-all] ${r.message ?? "soft-skip promoted to fail"}`;
    }
    checkResults.push({ check, result: r });
    reporter?.check?.(spec, globalIdx, check, r);
    if (!r.ok && !r.skipped) allGatesPassed = false;
  }
  if (allGatesPassed) {
    for (const check of rubrics) {
      const r = await runCheck(check, ctx);
      if (requireAll && r.skipped && r.reason !== "gated") {
        r.ok = false;
        r.skipped = false;
        r.message = `[require-all] ${r.message ?? "soft-skip promoted to fail"}`;
      }
      checkResults.push({ check, result: r });
      reporter?.check?.(spec, globalIdx, check, r);
    }
  } else {
    for (const check of rubrics) {
      const r = {
        ok: true,
        skipped: true,
        reason: "gated",
        message: "gated by upstream failure — rubric not run",
      };
      checkResults.push({ check, result: r });
      reporter?.check?.(spec, globalIdx, check, r);
    }
  }
  return checkResults;
}

function resolveSessions(spec) {
  if (spec.sessions && spec.sessions.length > 0) {
    return spec.sessions.map((s) => ({ id: s.id, agent: s.agent, runtime: s.runtime ?? null }));
  }
  return [{ id: DEFAULT_SESSION_ID, agent: spec.agent, runtime: spec.runtime ?? null }];
}

// Lazy substrate handle — clones only when a substrate.* check or
// action first requests it. Keeps session-only evals free of git work.
function makeLazySubstrate(spec) {
  const lazy = {
    handle: null,
    async ensureClone() {
      if (lazy.handle) return lazy.handle.ensureClone();
      const cfg = await loadEvalConfig();
      const org = requireEvalOrg(cfg);
      lazy.handle = new SubstrateHandle({ org });
      return lazy.handle.ensureClone();
    },
    async refresh() { await lazy.ensureClone(); return lazy.handle.refresh(); },
    async readFile(p) { await lazy.ensureClone(); return lazy.handle.readFile(p); },
    async listTree(p, o) { await lazy.ensureClone(); return lazy.handle.listTree(p, o); },
    async isGitignored(p) { await lazy.ensureClone(); return lazy.handle.isGitignored(p); },
    async removePath(p, o) { await lazy.ensureClone(); return lazy.handle.removePath(p, o); },
    async commitAndPush(m, reapply) { await lazy.ensureClone(); return lazy.handle.commitAndPush(m, reapply); },
  };
  return lazy;
}

function needsSubstrate(checks) {
  if (!Array.isArray(checks)) return false;
  return checks.some(checkTouchesSubstrate);
}

function checkTouchesSubstrate(c) {
  if (!c || typeof c !== "object") return false;
  if (typeof c.kind === "string") {
    if (c.kind.startsWith("substrate.") || c.kind.startsWith("workbook.")) return true;
    // session.poll_until wraps its real assertion in a `predicate` field.
    // Without this, polling for substrate state slips past needsSubstrate
    // → no pre-clone → workdir is null → BEAM runtime can't register the
    // substrate_push tool, and the agent reports "git push isn't available".
    if (c.kind === "session.poll_until" && c.predicate) {
      return checkTouchesSubstrate(c.predicate);
    }
  }
  return false;
}

function sleep(ms, abortSignal) {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => { abortSignal?.removeEventListener?.("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
    abortSignal?.addEventListener?.("abort", onAbort);
  });
}

function driveChat({ agent, prompt, sessionId, timeoutMs, abortSignal, runtime, orgId, workdir }) {
  return new Promise((resolve, reject) => {
    const args = ["chat", agent, prompt, "--json"];
    if (sessionId) args.push("--session", sessionId);
    args.push("--runtime", runtime ?? "linux-sandbox");
    if (orgId) args.push("--org", orgId);
    if (workdir) args.push("--workdir", workdir);

    // wb-ht4q.12.15 — when the spec routes to the BEAM runtime, swap
    // the spawn target from `workbook chat` to `mix wb.agent.chat` in
    // apps/studio/workhorse/. Protocol is identical (NDJSON
    // chat.open / message_delta / tool_start / tool_result / chat.close)
    // — only the spawn target changes.
    const isBeam = (runtime ?? "linux-sandbox") === "beam";
    const resolved = isBeam ? resolveBeamRunner(args) : spawnArgsForWorkbook(args);
    const [spawnCmd, spawnArgs, extraSpawnOpts] = resolved.length === 3
      ? resolved
      : [resolved[0], resolved[1], {}];
    const child = spawn(spawnCmd, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      ...extraSpawnOpts,
    });

    const events = [];
    let chatStatus = null;
    let resolvedSessionId = sessionId ?? null;
    let stdoutBuf = "";
    let stderrBuf = "";

    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch { /* noop */ }
    };
    abortSignal?.addEventListener("abort", onAbort);

    const timer = timeoutMs
      ? setTimeout(() => {
          try { child.kill("SIGTERM"); } catch { /* noop */ }
          reject(new Error(`driveChat: timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (parsed.kind === "chat.open") {
          resolvedSessionId = parsed.sessionId ?? resolvedSessionId;
        } else if (parsed.kind === "chat.close") {
          chatStatus = parsed.status ?? null;
        } else {
          events.push(parsed);
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderrBuf += chunk; });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      if (code !== 0 && chatStatus !== "done") {
        const tail = stderrBuf.trim().split("\n").slice(-5).join("\n");
        reject(new Error(`workbook chat exited ${code}${tail ? `: ${tail}` : ""}`));
        return;
      }
      resolve({ events, sessionId: resolvedSessionId, status: chatStatus });
    });
  });
}
