#!/usr/bin/env node
// wavelet.commercial action — unit tests.
//
// Uses a stub `wavelet` binary (shell script that touches commercial.mp4
// and writes a fake trace line) so tests don't need the real binary or
// paid backends.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gamutActions } from "../src/eval/actions/wavelet.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..", "..");
const SHIM_PATH = path.resolve(REPO_ROOT, "packages", "wavelet", "evals", "bin", "wavelet-traced");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++;
  else fail++;
}

async function makeStubGamut(dir) {
  // Stub wavelet binary. Writes a non-empty stdout, drops a commercial.mp4
  // into cwd, and emits a fake trace line via the shim's normal flow.
  const stubPath = path.join(dir, "wavelet");
  await fs.writeFile(
    stubPath,
    `#!/usr/bin/env bash
set -u
# Mimic a successful run: produce an artifact in cwd.
echo "stub wavelet: args=$*"
: > commercial.mp4
exit 0
`,
    "utf8",
  );
  await fs.chmod(stubPath, 0o755);
  return stubPath;
}

async function makeStubAgent(dir, scriptBody) {
  // A stub agent that runs `wavelet something` (so the shim fires) and then
  // does whatever scriptBody says.
  const agentPath = path.join(dir, "stub-agent");
  await fs.writeFile(
    agentPath,
    `#!/usr/bin/env bash
set -u
wavelet probe --stub || true
${scriptBody}
`,
    "utf8",
  );
  await fs.chmod(agentPath, 0o755);
  return agentPath;
}

async function makeBrief(dir, content = "# Test brief\n\nMake a thing.\n") {
  const p = path.join(dir, "brief.md");
  await fs.writeFile(p, content, "utf8");
  return p;
}

async function staticCtx(specName = "wavelet-test") {
  return { spec: { name: specName } };
}

async function runHappyPath() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wavelet-test-"));
  const briefPath = await makeBrief(tmp);
  const stubGamut = await makeStubGamut(tmp);

  // Stub workhorse: write an exec-able wrapper at <tmp>/workbook.mjs that
  // the action will spawn for agent=workhorse. We instead use agent=claude
  // and put a fake `claude` first on PATH.
  const fakeBinDir = path.join(tmp, "fake-bin");
  await fs.mkdir(fakeBinDir, { recursive: true });
  const claudeStub = path.join(fakeBinDir, "claude");
  // The "agent" needs to run a wavelet call so the shim writes a trace line.
  await fs.writeFile(
    claudeStub,
    `#!/usr/bin/env bash
set -u
echo "claude stub running, cwd=$(pwd)"
echo "GAMUT_TRACE=$GAMUT_TRACE"
echo "GAMUT_DRY_RUN=$GAMUT_DRY_RUN"
wavelet render --stub || true
echo "done"
exit 0
`,
    "utf8",
  );
  await fs.chmod(claudeStub, 0o755);

  const ctx = await staticCtx("happy");
  const prevPath = process.env.PATH;
  const prevGamutReal = process.env.GAMUT_REAL;
  process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.GAMUT_REAL = stubGamut;

  let result;
  try {
    result = await gamutActions["wavelet.commercial"](ctx, {
      brief: briefPath,
      agent: "claude",
      dry_run: true,
      run_id: "happy-test",
      timeout_ms: 30_000,
      // Stub wavelet writes a zero-byte commercial.mp4; legacy ok semantics.
      validate_mp4: false,
    });
  } finally {
    process.env.PATH = prevPath;
    if (prevGamutReal === undefined) delete process.env.GAMUT_REAL;
    else process.env.GAMUT_REAL = prevGamutReal;
  }

  check("happy: ok=true", result.ok === true, { msg: result.message });
  check("happy: retries_used=0", result.retries_used === 0);
  check("happy: retry_validation_errors empty", Array.isArray(result.retry_validation_errors) && result.retry_validation_errors.length === 0);
  check("happy: ctx.gamutRunDir is set", typeof ctx.gamutRunDir === "string");
  check("happy: ctx.gamutWorkdir is set", typeof ctx.gamutWorkdir === "string");
  check("happy: ctx.gamutTrace is set", typeof ctx.gamutTrace === "string");
  check("happy: ctx.gamutCommercialMp4 is set", typeof ctx.gamutCommercialMp4 === "string");

  // commercial.mp4 was created by the stub wavelet.
  const mp4Exists = await fs.access(ctx.gamutCommercialMp4).then(() => true).catch(() => false);
  check("happy: commercial.mp4 exists in workdir", mp4Exists, { path: ctx.gamutCommercialMp4 });

  // brief was staged into workdir.
  const briefStaged = await fs.access(path.join(ctx.gamutWorkdir, "brief.md")).then(() => true).catch(() => false);
  check("happy: brief.md staged into workdir", briefStaged);

  // trace.wavelet.jsonl has at least one entry (the agent ran `wavelet render`).
  const traceData = await fs.readFile(ctx.gamutTrace, "utf8");
  const traceLines = traceData.trim().split("\n").filter(Boolean);
  check("happy: trace has >=1 entry", traceLines.length >= 1, { lines: traceLines.length });
  if (traceLines.length > 0) {
    let parsed;
    try { parsed = JSON.parse(traceLines[0]); } catch {}
    check("happy: trace entry is JSON with argv", parsed && Array.isArray(parsed.argv));
  }

  // meta.json was written and has the expected shape.
  const metaPath = path.join(ctx.gamutRunDir, "meta.json");
  const metaRaw = await fs.readFile(metaPath, "utf8");
  const meta = JSON.parse(metaRaw);
  check("meta: agent=claude", meta.agent === "claude");
  check("meta: dry_run=true", meta.dry_run === true);
  check("meta: exit_code=0", meta.exit_code === 0);
  check("meta: has env.PATH", typeof meta.env?.PATH === "string");
  check("meta: GAMUT_DRY_RUN propagated", meta.env?.GAMUT_DRY_RUN === "1");

  // Return the meta object so we can print a sample at the end.
  return meta;
}

async function runMissingBrief() {
  const ctx = await staticCtx("missing-brief");
  const result = await gamutActions["wavelet.commercial"](ctx, {
    brief: "/nonexistent/path/brief.md",
    agent: "claude",
    dry_run: true,
  });
  check("missing brief: ok=false", result.ok === false);
  check("missing brief: clear message", typeof result.message === "string" && result.message.includes("not found"));
}

async function runValidationFailNoRetry() {
  // validate_mp4=true, retries=0. Stub wavelet produces empty commercial.mp4
  // → validation fails → ok=false, retries_used=0.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wavelet-novalidate-"));
  const briefPath = await makeBrief(tmp);
  const stubGamut = await makeStubGamut(tmp);
  const fakeBinDir = path.join(tmp, "fake-bin");
  await fs.mkdir(fakeBinDir, { recursive: true });
  const claudeStub = path.join(fakeBinDir, "claude");
  await fs.writeFile(
    claudeStub,
    `#!/usr/bin/env bash
set -u
wavelet render --stub || true
exit 0
`,
    "utf8",
  );
  await fs.chmod(claudeStub, 0o755);

  const ctx = await staticCtx("validate-fail");
  const prevPath = process.env.PATH;
  const prevGamutReal = process.env.GAMUT_REAL;
  process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.GAMUT_REAL = stubGamut;

  let result;
  try {
    result = await gamutActions["wavelet.commercial"](ctx, {
      brief: briefPath,
      agent: "claude",
      dry_run: true,
      run_id: "validate-fail-test",
      timeout_ms: 30_000,
      retries: 0,
      validate_mp4: true,
    });
  } finally {
    process.env.PATH = prevPath;
    if (prevGamutReal === undefined) delete process.env.GAMUT_REAL;
    else process.env.GAMUT_REAL = prevGamutReal;
  }

  check("validate-fail: ok=false", result.ok === false, { msg: result.message });
  check("validate-fail: retries_used=0", result.retries_used === 0);
  check(
    "validate-fail: validation_error mentions bytes or missing",
    typeof result.validation_error === "string" &&
      (result.validation_error.includes("bytes") || result.validation_error.includes("missing")),
    { err: result.validation_error },
  );
}

async function runRetrySucceeds() {
  // validate_mp4=true, retries=2. Stub agent fails on attempt 1 (writes
  // empty mp4), succeeds on attempt 2 (writes a valid mp4 with moov atom).
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wavelet-retry-"));
  const briefPath = await makeBrief(tmp);
  const stubGamut = await makeStubGamut(tmp);
  const fakeBinDir = path.join(tmp, "fake-bin");
  await fs.mkdir(fakeBinDir, { recursive: true });
  const counterPath = path.join(tmp, "attempt-count");
  await fs.writeFile(counterPath, "0", "utf8");

  const claudeStub = path.join(fakeBinDir, "claude");
  // The stub increments a counter and on attempt 2+ produces a valid MP4
  // (60KB of zeros, with 'moov' embedded near the start).
  await fs.writeFile(
    claudeStub,
    `#!/usr/bin/env bash
set -u
COUNTER_FILE="${counterPath}"
N=$(cat "$COUNTER_FILE")
N=$((N+1))
echo "$N" > "$COUNTER_FILE"
echo "claude stub attempt=$N"
wavelet render --stub || true
if [ "$N" -ge 2 ]; then
  # Write a 60KB file that contains 'moov' near the start.
  python3 -c "
import sys
data = bytearray(60 * 1024)
data[8:12] = b'moov'
open('commercial.mp4', 'wb').write(bytes(data))
" || {
    # Fallback if python3 isn't available — use dd + printf.
    dd if=/dev/zero of=commercial.mp4 bs=1024 count=60 2>/dev/null
    printf 'moov' | dd of=commercial.mp4 bs=1 seek=8 count=4 conv=notrunc 2>/dev/null
  }
fi
exit 0
`,
    "utf8",
  );
  await fs.chmod(claudeStub, 0o755);

  const ctx = await staticCtx("retry-success");
  const prevPath = process.env.PATH;
  const prevGamutReal = process.env.GAMUT_REAL;
  process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.GAMUT_REAL = stubGamut;

  let result;
  try {
    result = await gamutActions["wavelet.commercial"](ctx, {
      brief: briefPath,
      agent: "claude",
      dry_run: true,
      run_id: "retry-success-test",
      timeout_ms: 30_000,
      retries: 2,
      validate_mp4: true,
    });
  } finally {
    process.env.PATH = prevPath;
    if (prevGamutReal === undefined) delete process.env.GAMUT_REAL;
    else process.env.GAMUT_REAL = prevGamutReal;
  }

  check("retry-success: ok=true", result.ok === true, { msg: result.message });
  check("retry-success: retries_used=1", result.retries_used === 1, { retries_used: result.retries_used });
  check(
    "retry-success: one validation error recorded",
    Array.isArray(result.retry_validation_errors) && result.retry_validation_errors.length === 1,
    { errs: result.retry_validation_errors },
  );

  // transcript.retry-1.log should exist alongside transcript.log.
  const retryTranscript = path.join(result.run_dir, "transcript.retry-1.log");
  const exists = await fs.access(retryTranscript).then(() => true).catch(() => false);
  check("retry-success: transcript.retry-1.log exists", exists, { path: retryTranscript });

  // meta.json should have an attempts array of length 2.
  const meta = JSON.parse(await fs.readFile(path.join(result.run_dir, "meta.json"), "utf8"));
  check("retry-success: meta.attempts length=2", Array.isArray(meta.attempts) && meta.attempts.length === 2);
  check("retry-success: meta.retries_used=1", meta.retries_used === 1);
}

async function runTimeout() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wavelet-timeout-"));
  const briefPath = await makeBrief(tmp);
  const stubGamut = await makeStubGamut(tmp);
  const fakeBinDir = path.join(tmp, "fake-bin");
  await fs.mkdir(fakeBinDir, { recursive: true });
  const claudeStub = path.join(fakeBinDir, "claude");
  // Sleeping agent — will be killed.
  // Use exec so SIGTERM goes straight to sleep (no bash holding stdio).
  await fs.writeFile(
    claudeStub,
    `#!/usr/bin/env bash
exec sleep 60
`,
    "utf8",
  );
  await fs.chmod(claudeStub, 0o755);

  const ctx = await staticCtx("timeout");
  const prevPath = process.env.PATH;
  const prevGamutReal = process.env.GAMUT_REAL;
  process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.GAMUT_REAL = stubGamut;

  let result;
  const t0 = Date.now();
  try {
    result = await gamutActions["wavelet.commercial"](ctx, {
      brief: briefPath,
      agent: "claude",
      dry_run: true,
      run_id: "timeout-test",
      timeout_ms: 500,
      retries: 0,
      validate_mp4: false,
    });
  } finally {
    process.env.PATH = prevPath;
    if (prevGamutReal === undefined) delete process.env.GAMUT_REAL;
    else process.env.GAMUT_REAL = prevGamutReal;
  }
  const elapsed = Date.now() - t0;

  check("timeout: ok=false", result.ok === false);
  check("timeout: timed_out=true", result.timed_out === true);
  check("timeout: completed within reasonable bound", elapsed < 15_000, { elapsed });
  check("timeout: message mentions timed out", typeof result.message === "string" && result.message.toLowerCase().includes("timed out"));
}

async function main() {
  // Sanity: the shim must exist for the tests to mean anything.
  try {
    await fs.access(SHIM_PATH, fs.constants.X_OK);
  } catch {
    console.error(`SKIP: shim not found at ${SHIM_PATH}`);
    process.exit(0);
  }

  let sampleMeta = null;
  try {
    sampleMeta = await runHappyPath();
  } catch (err) {
    console.error("happy path threw:", err);
    fail++;
  }
  try {
    await runMissingBrief();
  } catch (err) {
    console.error("missing-brief threw:", err);
    fail++;
  }
  try {
    await runTimeout();
  } catch (err) {
    console.error("timeout threw:", err);
    fail++;
  }
  try {
    await runValidationFailNoRetry();
  } catch (err) {
    console.error("validation-fail threw:", err);
    fail++;
  }
  try {
    await runRetrySucceeds();
  } catch (err) {
    console.error("retry-success threw:", err);
    fail++;
  }

  // Clean up the run dirs we created under the real evals/runs/ tree.
  for (const id of ["happy-test", "timeout-test", "validate-fail-test", "retry-success-test"]) {
    const p = path.resolve(REPO_ROOT, "packages", "wavelet", "evals", "runs", id);
    await fs.rm(p, { recursive: true, force: true }).catch(() => {});
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  if (sampleMeta) {
    console.log("\n--- sample meta.json ---");
    console.log(JSON.stringify(sampleMeta, null, 2));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(2);
});
