// wavelet.* — actions that spawn a coding agent against a wavelet creative
// brief and capture every wavelet subcommand the agent runs.
//
// wavelet.commercial mirrors `packages/wavelet/evals/runner.sh` in JS so
// the workbook-cli eval framework can drive it directly. The agent's
// $PATH is rewritten so every `wavelet …` call goes through the
// wavelet-traced shim, which appends a JSONL record per invocation to
// $WAVELET_TRACE before forwarding to the real binary.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolveWorkbookBin } from "../../util/workbook-bin.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = packages/workbooks/packages/workbench/src/eval/actions
// repo root = HERE + 7 (../../../../../../..)
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..", "..", "..", "..");

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_BUDGET_USD = 5;
const DEFAULT_RETRIES = 2;
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
// Minimum sane size for a finalized MP4 with even a couple seconds of video.
// A zero-byte or 4KB partial file is the failure mode we saw 2026-05-21.
const MIN_MP4_BYTES = 50 * 1024;
// Tail window scanned for the `moov` atom — finalized MP4s either put moov
// near the end (default ffmpeg/rsmpeg) or, if faststart, near the front.
// 256KB covers both cases when combined with the head scan below.
const MOOV_SCAN_BYTES = 256 * 1024;

const FORWARDED_API_KEYS = [
  "FAL_KEY",
  "REPLICATE_API_TOKEN",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "ELEVENLABS_API_KEY",
  "OPENROUTER_API_KEY",
];

// Path to the optional wavelet env file. Anything written here as
// KEY=value lines gets merged into the agent's child env, alongside
// whatever's already in process.env. Lets the user provision FAL_KEY /
// GOOGLE_API_KEY / etc. once instead of exporting in every shell.
const WAVELET_ENV_FILE = path.join(
  process.env.HOME ?? "",
  ".config",
  "wavelet",
  "env",
);

/**
 * Read KEY=value lines from ~/.config/wavelet/env (if it exists).
 * Format: one var per line, no quoting magic, no shell expansion.
 * Lines starting with # are comments; blank lines ignored.
 */
async function readWaveletEnvFile() {
  let raw;
  try {
    raw = await fs.readFile(WAVELET_ENV_FILE, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export const waveletActions = {
  /**
   * Spawn a coding agent inside a fresh run dir, with a PATH-rewritten
   * `wavelet` shim, against a creative brief. Used by both the wavelet eval
   * specs and as a check (its ok-ness gates downstream rubrics).
   *
   *   - kind: wavelet.commercial
   *     brief: packages/wavelet/evals/briefs/001-mini-coffee.md   # required
   *     run_id: my-run                                          # optional
   *     agent: workhorse | claude | codex                        # default workhorse
   *     budget_usd: 5                                            # default 5
   *     pipeline: commercial                                     # default 'commercial'
   *     dry_run: false                                           # default false
   *     timeout_ms: 1800000                                      # default 30 min
   *     retries: 2                                               # default 2 (extra attempts on validation fail)
   *     validate_mp4: true                                       # default true; false skips post-run validation
   *
   * On success: sets ctx.waveletRunDir, ctx.waveletWorkdir, ctx.waveletTrace,
   * ctx.waveletCommercialMp4 so downstream checks can locate artifacts.
   */
  "wavelet.commercial": waveletCommercial,
};

async function waveletCommercial(ctx, params) {
  if (!params || typeof params.brief !== "string") {
    return { ok: false, message: `wavelet.commercial: requires "brief" (string)` };
  }
  const briefPath = path.isAbsolute(params.brief)
    ? params.brief
    : path.resolve(REPO_ROOT, params.brief);
  try {
    const s = await fs.stat(briefPath);
    if (!s.isFile()) {
      return { ok: false, message: `wavelet.commercial: brief is not a file: ${briefPath}` };
    }
  } catch {
    return { ok: false, message: `wavelet.commercial: brief not found: ${briefPath}` };
  }

  const agent = params.agent ?? "worg-agent";
  if (!["worg-agent", "workhorse", "claude", "codex"].includes(agent)) {
    return {
      ok: false,
      message: `wavelet.commercial: unknown agent "${agent}" (want: worg-agent | workhorse | claude | codex)`,
    };
  }
  const budgetUsd = typeof params.budget_usd === "number" ? params.budget_usd : DEFAULT_BUDGET_USD;
  const pipeline = typeof params.pipeline === "string" ? params.pipeline : "commercial";
  const dryRun = params.dry_run === true;
  const timeoutMs = typeof params.timeout_ms === "number" ? params.timeout_ms : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(params.retries) && params.retries >= 0 ? params.retries : DEFAULT_RETRIES;
  const validateMp4 = params.validate_mp4 !== false;

  const specName = ctx?.spec?.name ?? "wavelet-commercial";
  const safeStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = params.run_id ?? `${specName}-${safeStamp}`;

  const runDir = path.resolve(REPO_ROOT, "packages", "wavelet", "evals", "runs", runId);
  const workdir = path.join(runDir, "workdir");
  const transcriptPath = path.join(runDir, "transcript.log");
  const metaPath = path.join(runDir, "meta.json");
  // Trace + shim live INSIDE workdir/ so they're inside the agent's
  // declared writable workspace. Some agents (codex --cd workdir)
  // tidy up siblings of their workdir on exit; keeping the
  // instrumentation inside avoids that.
  const tracePath = path.join(workdir, ".wavelet-trace.jsonl");
  const adalignTracePath = path.join(workdir, ".adalign-trace.jsonl");
  const shimBinDir = path.join(workdir, ".bin");

  try {
    await fs.mkdir(workdir, { recursive: true });
    await fs.mkdir(shimBinDir, { recursive: true });
  } catch (err) {
    return { ok: false, message: `wavelet.commercial: failed to create run dir: ${err.message}` };
  }
  // Touch trace files so the shims can append even if no calls happen.
  await fs.writeFile(tracePath, "", "utf8");
  await fs.writeFile(adalignTracePath, "", "utf8");
  await fs.writeFile(transcriptPath, "", "utf8");

  // Read the brief. In default mode it's also staged at workdir/brief.md
  // so the agent's cwd carries it as a file. In adversarial mode the
  // brief content becomes the prompt only — no file is written and the
  // agent must author its own brief.md as a deliverable.
  const adversarial = params.adversarial === true;
  let briefContents;
  try {
    briefContents = await fs.readFile(briefPath, "utf8");
    if (!adversarial) {
      await fs.writeFile(path.join(workdir, "brief.md"), briefContents, "utf8");
    }
  } catch (err) {
    return { ok: false, message: `wavelet.commercial: failed to read brief: ${err.message}` };
  }

  // Locate the real wavelet binary.
  let waveletReal = null;
  if (process.env.WAVELET_REAL) {
    try {
      await fs.access(process.env.WAVELET_REAL, fs.constants.X_OK);
      waveletReal = process.env.WAVELET_REAL;
    } catch { /* fall through */ }
  }
  if (!waveletReal) {
    const candidate = path.resolve(REPO_ROOT, "packages", "wavelet", "target", "debug", "wavelet");
    try {
      await fs.access(candidate, fs.constants.X_OK);
      waveletReal = candidate;
    } catch { /* fall through */ }
  }
  if (!waveletReal) {
    const fromPath = await whichSync("wavelet");
    if (fromPath) waveletReal = fromPath;
  }
  if (!waveletReal) {
    return {
      ok: false,
      message: `wavelet.commercial: could not locate wavelet binary (set WAVELET_REAL or build with 'cargo build --bin wavelet')`,
    };
  }

  // Locate the shim. It lives in the repo at packages/wavelet/evals/bin.
  const shim = path.resolve(REPO_ROOT, "packages", "wavelet", "evals", "bin", "wavelet-traced");
  try {
    await fs.access(shim, fs.constants.X_OK);
  } catch {
    return {
      ok: false,
      message: `wavelet.commercial: wavelet-traced shim missing or not executable at ${shim}`,
    };
  }
  // Symlink shim into the per-run bin/ as `wavelet`.
  const shimLink = path.join(shimBinDir, "wavelet");
  try {
    await fs.symlink(shim, shimLink);
  } catch (err) {
    if (err.code !== "EEXIST") {
      return { ok: false, message: `wavelet.commercial: failed to link shim: ${err.message}` };
    }
  }

  // Locate the real adalign binary. Same lookup order as wavelet: env
  // override → ~/.local/bin/adalign → PATH. Adalign is optional — the
  // research-stage gate will fail loudly if the agent doesn't call it,
  // but if no adalign binary exists at all the shim still gets linked
  // (calls will exit 127 with a clear error in the trace).
  let adalignReal = null;
  if (process.env.ADALIGN_REAL) {
    try {
      await fs.access(process.env.ADALIGN_REAL, fs.constants.X_OK);
      adalignReal = process.env.ADALIGN_REAL;
    } catch { /* fall through */ }
  }
  if (!adalignReal) {
    const fromPath = await whichSync("adalign");
    if (fromPath) adalignReal = fromPath;
  }
  if (!adalignReal) {
    const home = process.env.HOME ?? "";
    const candidate = path.join(home, ".local", "bin", "adalign");
    try {
      await fs.access(candidate, fs.constants.X_OK);
      adalignReal = candidate;
    } catch { /* fall through */ }
  }

  // Locate + link the adalign shim. Shim is required (lives in-repo),
  // but the real binary may be absent (shim will surface the error per
  // invocation via exit 127 in the trace).
  const adalignShim = path.resolve(REPO_ROOT, "packages", "wavelet", "evals", "bin", "adalign-traced");
  try {
    await fs.access(adalignShim, fs.constants.X_OK);
  } catch {
    return {
      ok: false,
      message: `wavelet.commercial: adalign-traced shim missing or not executable at ${adalignShim}`,
    };
  }
  const adalignShimLink = path.join(shimBinDir, "adalign");
  try {
    await fs.symlink(adalignShim, adalignShimLink);
  } catch (err) {
    if (err.code !== "EEXIST") {
      return { ok: false, message: `wavelet.commercial: failed to link adalign shim: ${err.message}` };
    }
  }

  // Build the child env. Per-run config-cascade isolation lives in
  // WAVELET_HOME below (wb-uory.12). Real HOME is inherited so agent
  // CLIs (claude, codex, workhorse) keep their auth files intact.
  const childEnv = { ...process.env };
  childEnv.WAVELET_REAL = waveletReal;
  childEnv.WAVELET_TRACE = tracePath;
  childEnv.WAVELET_MAX_COST = String(budgetUsd);
  if (dryRun) childEnv.WAVELET_DRY_RUN = "1";
  if (adalignReal) childEnv.ADALIGN_REAL = adalignReal;
  childEnv.ADALIGN_TRACE = adalignTracePath;
  childEnv.PATH = `${shimBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
  // wb-uory.12 — surgical config-cascade isolation. WAVELET_HOME points
  // at an empty per-run dir, so wavelet's cascade.rs::dirs_home picks
  // it up instead of $HOME for resolving ~/.wavelet/config.toml. Global
  // HOME stays untouched, so agent-CLIs (claude/codex/workhorse) still
  // see their normal auth files.
  const waveletHome = path.join(runDir, ".wavelet-home");
  await fs.mkdir(waveletHome, { recursive: true });
  childEnv.WAVELET_HOME = waveletHome;
  // Source ~/.config/wavelet/env first (if present), then let real env
  // vars override — so a user can pin a fallback FAL_KEY in the file
  // but still hot-swap it via `FAL_KEY=... workbench eval ...`.
  const fileEnv = await readWaveletEnvFile();
  for (const k of FORWARDED_API_KEYS) {
    if (fileEnv[k]) childEnv[k] = fileEnv[k];
    if (process.env[k]) childEnv[k] = process.env[k];
  }

  const commercialMp4 = path.join(workdir, "commercial.mp4");

  // Split the overall timeout across the initial attempt + retries.
  // 1800s with 2 retries = 600s each. Validation is fast (<1s) so we
  // don't bother carving time out for it.
  const totalAttempts = 1 + retries;
  const perAttemptTimeoutMs = Math.max(1, Math.floor(timeoutMs / totalAttempts));

  const overallStartedAt = new Date();
  const overallStartedMs = Date.now();

  /** @type {Array<{exit_code: number|null, duration_ms: number, timed_out: boolean, validation_error: string|null, transcript_path: string}>} */
  const attempts = [];
  let lastValidationError = null;
  let lastTranscriptTail = "";
  let attemptPromptContents = briefContents;

  for (let attemptIdx = 0; attemptIdx < totalAttempts; attemptIdx++) {
    const isRetry = attemptIdx > 0;
    const attemptTranscriptPath = isRetry
      ? path.join(runDir, `transcript.retry-${attemptIdx}.log`)
      : transcriptPath;
    if (isRetry) {
      await fs.writeFile(attemptTranscriptPath, "", "utf8");
    }

    const { exitCode, timedOut, durationMs, transcriptTail } = await runAgentOnce({
      agent,
      workdir,
      childEnv,
      timeoutMs: perAttemptTimeoutMs,
      promptContents: attemptPromptContents,
      transcriptPath: attemptTranscriptPath,
    });
    lastTranscriptTail = transcriptTail;

    let validationError = null;
    if (validateMp4) {
      if (exitCode !== 0 || timedOut) {
        validationError = timedOut
          ? `attempt timed out after ${perAttemptTimeoutMs}ms`
          : `attempt exited with non-zero code ${exitCode}`;
      } else {
        validationError = await validateCommercialOutput({
          commercialMp4,
          workdir,
          waveletReal,
          pipeline,
          childEnv,
        });
      }
    } else {
      // validate_mp4=false → preserve legacy ok semantics
      if (exitCode !== 0 || timedOut) {
        validationError = timedOut
          ? `attempt timed out after ${perAttemptTimeoutMs}ms`
          : `attempt exited with non-zero code ${exitCode}`;
      }
    }

    attempts.push({
      exit_code: exitCode,
      duration_ms: durationMs,
      timed_out: timedOut,
      validation_error: validationError,
      transcript_path: attemptTranscriptPath,
    });

    if (!validationError) {
      lastValidationError = null;
      break;
    }
    lastValidationError = validationError;

    // Build a retry prompt for the next attempt (if any remain).
    if (attemptIdx < totalAttempts - 1) {
      attemptPromptContents = buildRetryPrompt({
        validationError,
        workdir,
        briefContents,
      });
    }
  }

  const overallEndedAt = new Date();
  const overallDurationMs = Date.now() - overallStartedMs;

  const finalAttempt = attempts[attempts.length - 1];
  const retriesUsed = Math.max(0, attempts.length - 1);
  const ok = !lastValidationError;

  const meta = {
    run_id: runId,
    spec_name: specName,
    brief_path: briefPath,
    agent,
    budget_usd: budgetUsd,
    pipeline,
    dry_run: dryRun,
    timeout_ms: timeoutMs,
    per_attempt_timeout_ms: perAttemptTimeoutMs,
    validate_mp4: validateMp4,
    retries_allowed: retries,
    retries_used: retriesUsed,
    attempts,
    // Legacy top-level fields kept for compatibility with old readers.
    timed_out: finalAttempt.timed_out,
    exit_code: finalAttempt.exit_code,
    started_at: overallStartedAt.toISOString(),
    ended_at: overallEndedAt.toISOString(),
    duration_ms: overallDurationMs,
    wavelet_real: waveletReal,
    shim,
    workdir,
    transcript_path: transcriptPath,
    trace_path: tracePath,
    adalign_trace_path: adalignTracePath,
    adalign_real: adalignReal,
    commercial_mp4: commercialMp4,
    final_validation_error: lastValidationError,
    env: redactEnv(childEnv),
  };
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

  ctx.waveletRunDir = runDir;
  ctx.waveletWorkdir = workdir;
  ctx.waveletTrace = tracePath;
  ctx.waveletAdalignTrace = adalignTracePath;
  ctx.waveletTranscript = transcriptPath;
  ctx.waveletCommercialMp4 = commercialMp4;

  const retryValidationErrors = attempts
    .slice(0, -1)
    .map((a) => a.validation_error)
    .filter((e) => typeof e === "string");

  let message;
  if (ok) {
    message = retriesUsed > 0
      ? `wavelet.commercial: ${agent} succeeded on retry ${retriesUsed} (total ${overallDurationMs}ms)`
      : `wavelet.commercial: ${agent} ran for ${overallDurationMs}ms (exit ${finalAttempt.exit_code})`;
  } else if (finalAttempt.timed_out) {
    message = `wavelet.commercial: timed out (${retriesUsed} retries used; last error: ${lastValidationError})`;
  } else {
    message = `wavelet.commercial: validation failed after ${retriesUsed} retries — ${lastValidationError}`;
  }

  return {
    ok,
    message,
    run_dir: runDir,
    workdir,
    trace: tracePath,
    adalign_trace: adalignTracePath,
    transcript_path: transcriptPath,
    transcript_tail: lastTranscriptTail,
    commercial_mp4: commercialMp4,
    exit_code: finalAttempt.exit_code,
    duration_ms: overallDurationMs,
    timed_out: finalAttempt.timed_out,
    retries_used: retriesUsed,
    retry_validation_errors: retryValidationErrors,
    validation_error: lastValidationError,
  };
}

/**
 * Spawn one agent attempt. Returns its exit info + transcript tail.
 * Appends to the provided transcriptPath (created/truncated by caller).
 */
async function runAgentOnce({ agent, workdir, childEnv, timeoutMs, promptContents, transcriptPath }) {
  let cmd;
  let args;
  if (agent === "worg-agent") {
    // wb-ki6b.8 — drive the Rust worg-agent runtime against the
    // wavelet-director.org agent definition. Same binary used for
    // local CLI runs; eval runner just invokes it as a subprocess.
    // Looks for the binary at WORG_AGENT_REAL first (built-from-source
    // path), then falls back to "worg-agent" on PATH.
    const worgBin = childEnv.WORG_AGENT_REAL ?? (await whichSync("worg-agent"));
    if (!worgBin) {
      return {
        exitCode: -1,
        timedOut: false,
        durationMs: 0,
        transcriptTail:
          "[spawn error] worg-agent binary not found (set WORG_AGENT_REAL or build with `cargo build -p worg-agent --bin worg-agent`)\n",
      };
    }
    const agentOrg =
      childEnv.WORG_AGENT_DEFINITION ??
      // Default to the wavelet-director definition shipped in the
      // monorepo. Eval runs that want a different agent set
      // WORG_AGENT_DEFINITION explicitly.
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "..",
        "..",
        "..",
        "..",
        "..",
        "..",
        "..",
        "worg",
        "proposed",
        "agents",
        "wavelet-director.org",
      );
    cmd = worgBin;
    args = [
      "run",
      "--agent", agentOrg,
      "--workdir", workdir,
      "--prompt", promptContents,
      "--transcript", path.join(workdir, "worg-transcript.jsonl"),
      "--json",
    ];
  } else if (agent === "workhorse") {
    const bin = resolveWorkbookBin();
    const chatArgs = [
      "chat",
      "workhorse",
      promptContents,
      "--json",
      "--max-cost",
      String(childEnv.WAVELET_MAX_COST ?? "5"),
    ];
    if (typeof bin === "string") {
      cmd = process.execPath;
      args = [bin, ...chatArgs];
    } else {
      cmd = bin.name;
      args = chatArgs;
    }
  } else if (agent === "claude") {
    const claudeBin = await whichSync("claude");
    if (!claudeBin) {
      return { exitCode: -1, timedOut: false, durationMs: 0, transcriptTail: "[spawn error] claude CLI not found on PATH\n" };
    }
    cmd = claudeBin;
    args = ["-p", promptContents, "--add-dir", workdir, "--dangerously-skip-permissions"];
  } else {
    const codexBin = await whichSync("codex");
    if (!codexBin) {
      return { exitCode: -1, timedOut: false, durationMs: 0, transcriptTail: "[spawn error] codex CLI not found on PATH\n" };
    }
    cmd = codexBin;
    args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox", "workspace-write",
      "--cd", workdir,
      "--dangerously-bypass-approvals-and-sandbox",
      promptContents,
    ];
  }

  const startedMs = Date.now();
  const transcriptFd = await fs.open(transcriptPath, "a");
  let transcriptTail = "";
  let exitCode = null;
  let timedOut = false;

  const child = spawn(cmd, args, {
    cwd: workdir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const appendTranscript = async (chunk) => {
    try { await transcriptFd.write(chunk); } catch { /* noop */ }
    transcriptTail += chunk;
    if (transcriptTail.length > TRANSCRIPT_TAIL_BYTES) {
      transcriptTail = transcriptTail.slice(transcriptTail.length - TRANSCRIPT_TAIL_BYTES);
    }
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => { appendTranscript(d); });
  child.stderr.on("data", (d) => { appendTranscript(d); });

  let killTimer = null;
  let sigkillTimer = null;
  const exited = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      exitCode = code ?? (signal ? 128 : null);
      resolve();
    });
    child.on("error", (err) => {
      appendTranscript(`\n[spawn error] ${err.message}\n`);
      exitCode = -1;
      resolve();
    });
  });

  killTimer = setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGTERM"); } catch { /* noop */ }
    sigkillTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
    }, 5000);
  }, timeoutMs);

  await exited;
  if (killTimer) clearTimeout(killTimer);
  if (sigkillTimer) clearTimeout(sigkillTimer);
  await transcriptFd.close().catch(() => {});

  return {
    exitCode,
    timedOut,
    durationMs: Date.now() - startedMs,
    transcriptTail,
  };
}

/**
 * Cheap MP4 validity check + optional workflow status probe.
 * Returns null on success, or a short human-readable failure string.
 */
async function validateCommercialOutput({ commercialMp4, workdir, waveletReal, pipeline, childEnv }) {
  let stat;
  try {
    stat = await fs.stat(commercialMp4);
  } catch {
    return `commercial.mp4 is missing at ${commercialMp4}`;
  }
  if (!stat.isFile()) {
    return `commercial.mp4 exists but is not a regular file`;
  }
  if (stat.size < MIN_MP4_BYTES) {
    return `commercial.mp4 is ${stat.size} bytes (< ${MIN_MP4_BYTES}); render likely never finalized`;
  }
  const moovFound = await scanForMoov(commercialMp4, stat.size);
  if (!moovFound) {
    return `commercial.mp4 is corrupt (no moov atom — render likely hung)`;
  }

  // Workflow probe is best-effort — failure to spawn isn't fatal because
  // the MP4 already exists + has moov. But if it runs and reports a
  // non-complete stage, surface that.
  const workflowError = await probeWorkflow({ waveletReal, workdir, pipeline, childEnv });
  if (workflowError) return workflowError;

  return null;
}

/**
 * Scan the head and tail of an MP4 for the literal bytes "moov".
 * Finalized files have moov either near the start (faststart-rewrapped)
 * or near the end (default ffmpeg/rsmpeg). A truncated/hung render will
 * be missing it entirely.
 */
async function scanForMoov(filePath, fileSize) {
  let fd;
  try {
    fd = await fs.open(filePath, "r");
  } catch {
    return false;
  }
  try {
    const headLen = Math.min(MOOV_SCAN_BYTES, fileSize);
    const head = Buffer.alloc(headLen);
    await fd.read(head, 0, headLen, 0);
    if (head.includes("moov")) return true;

    if (fileSize > MOOV_SCAN_BYTES) {
      const tailLen = Math.min(MOOV_SCAN_BYTES, fileSize);
      const tail = Buffer.alloc(tailLen);
      await fd.read(tail, 0, tailLen, fileSize - tailLen);
      if (tail.includes("moov")) return true;
    }
    return false;
  } finally {
    await fd.close().catch(() => {});
  }
}

/**
 * Run `wavelet workflow run <pipeline> --workdir <workdir> --json` and look
 * for any non-complete stage. Best-effort — a 5s timeout, swallows failures
 * (no wavelet binary, JSON parse errors, etc.) so a flaky probe doesn't
 * spuriously fail an otherwise good run.
 */
async function probeWorkflow({ waveletReal, workdir, pipeline, childEnv }) {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    let child;
    try {
      // `wavelet workflow run` emits JSON by default; --text is the
      // flag for human output, --json is rejected.
      child = spawn(waveletReal, ["workflow", "run", pipeline, "--workdir", workdir], {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return finish(null);
    }

    const killer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      finish(null);
    }, 5000);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", () => { clearTimeout(killer); finish(null); });
    child.on("close", () => {
      clearTimeout(killer);
      try {
        const parsed = JSON.parse(stdout);
        const stages = Array.isArray(parsed?.stages) ? parsed.stages : null;
        if (!stages) return finish(null);
        for (const s of stages) {
          if (s && typeof s.status === "string" && s.status !== "complete") {
            return finish(`workflow stage ${s.name ?? "<unnamed>"} status: ${s.status}`);
          }
        }
        finish(null);
      } catch {
        finish(null);
      }
    });
  });
}

function buildRetryPrompt({ validationError, workdir, briefContents }) {
  return `Your previous attempt finished but the output was not valid:
  - ${validationError}

The workdir is preserved at ${workdir}. Check trace.wavelet.jsonl for the last wavelet call, look at scenes/*.html for pathological CSS, simplify if needed, and re-run wavelet render.

${briefContents}`;
}

function redactEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (FORWARDED_API_KEYS.includes(k) && typeof v === "string" && v.length > 0) {
      out[k] = `${v.slice(0, 4)}…`;
    } else if (
      k === "WAVELET_REAL" ||
      k === "WAVELET_TRACE" ||
      k === "WAVELET_MAX_COST" ||
      k === "WAVELET_DRY_RUN" ||
      k === "WAVELET_HOME" ||
      k === "WORG_AGENT_REAL" ||
      k === "WORG_AGENT_DEFINITION" ||
      k === "WORG_AGENT_VIDEO_MODEL" ||
      k === "ADALIGN_REAL" ||
      k === "ADALIGN_TRACE" ||
      k === "PATH"
    ) {
      out[k] = v;
    }
  }
  return out;
}

async function whichSync(bin) {
  const p = process.env.PATH ?? "";
  const dirs = p.split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    const candidate = path.join(d, bin);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* noop */ }
  }
  return null;
}
