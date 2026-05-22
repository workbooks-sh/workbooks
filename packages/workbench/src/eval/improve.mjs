// Phase C of wb-xpgr: the iterate-agent loop.
//
// Given a failing eval-spec summary (with its judge verdict), spawn
// an improver agent that proposes a SINGLE concrete change to the
// failing AGENT — never to the spec. The improver pulls the
// objective-thinking skill (via trigger words in its prompt), so its
// reasoning runs through the frame → evidence → competing views →
// adversarial check → synthesis → audit workflow before emitting
// the diff.
//
// Iteration 1: propose-only. Print the unified diff to stdout for
// human review. Iteration 2 (separate task) will add --auto +
// two-pass critic + auto-commit.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { spawnArgsForWorkbook } from "../util/workbook-bin.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// For iteration 1, workhorse is the only agent we know how to locate
// the manifest source for. Future: a registry mapping agent slug →
// source location.
const WORKHORSE_MANIFEST_PATH = "apps/workbooks-agent/convex/agentsCatalog.ts";

// Post-process the model's diff output: models reliably emit the
// shape (--- a/path, +++ b/path, context, -/+ lines) but skip the
// `@@ -L,N +L,M @@` header (they don't know the line numbers since
// we passed source without line numbers). We DO know the source —
// look up the first context line in the file and synthesize the
// hunk header so `git apply` accepts the patch.
export async function repairHunkHeaders(rawDiff, sourceText) {
  if (!sourceText) return rawDiff;
  const sourceLines = sourceText.split(/\r?\n/);
  const lines = rawDiff.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    // Detect a stub hunk header like `@@ @@` or `@@  @@` or even `@@@`
    const stub = ln.match(/^@@\s*@@\s*$/);
    if (!stub) { out.push(ln); i++; continue; }
    // Collect the hunk body until next @@ or EOF or end-of-diff
    const body = [];
    let j = i + 1;
    while (j < lines.length && !/^@@/.test(lines[j]) && !/^--- /.test(lines[j])) {
      body.push(lines[j]);
      j++;
    }
    // Find the first context line ` text` (or the first - line) in
    // source. That tells us where this hunk lives.
    let anchor = null;
    for (const b of body) {
      if (b.startsWith(" ") || b.startsWith("-")) {
        anchor = b.slice(1);
        break;
      }
    }
    if (anchor) {
      const sourceIdx = sourceLines.findIndex((s) => s === anchor);
      if (sourceIdx >= 0) {
        const minus = body.filter((b) => b.startsWith(" ") || b.startsWith("-")).length;
        const plus = body.filter((b) => b.startsWith(" ") || b.startsWith("+")).length;
        const start = sourceIdx + 1; // git diff is 1-indexed
        out.push(`@@ -${start},${minus} +${start},${plus} @@`);
        for (const b of body) out.push(b);
        i = j;
        continue;
      }
    }
    // Couldn't anchor; leave stub as-is (will fail apply but visible)
    out.push(ln);
    i++;
  }
  return out.join("\n");
}

// Apply a repaired diff, commit it to a fresh branch, and re-run the
// failing spec to measure delta. Returns:
//   { outcome: "converged" | "improved" | "regressed" | "no-change" | "apply-failed",
//     branch?, prePassRate, postPassRate, attempts: 1 }
//
// Convex/broker deploys are NOT triggered — the diff lands as a
// commit on a branch; deploys remain a human step.
export async function autoApplyAndRetry({ spec, diff, prePassRate, passK = 3 }) {
  const { spawn } = await import("node:child_process");
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");

  const run = (cmd, args, opts) => new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = ""; let stderr = "";
    c.stdout.setEncoding("utf8"); c.stderr.setEncoding("utf8");
    c.stdout.on("data", (d) => { stdout += d; });
    c.stderr.on("data", (d) => { stderr += d; });
    c.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  // 1. Stash the diff to a tempfile.
  const patchPath = path.join(os.tmpdir(), `wb-improver-${process.pid}-${Date.now()}.patch`);
  await fs.writeFile(patchPath, diff);

  // 2. Validate.
  const check = await run("git", ["apply", "--check", patchPath]);
  if (check.code !== 0) {
    await fs.rm(patchPath, { force: true }).catch(() => {});
    return { outcome: "apply-failed", message: check.stderr.trim().slice(0, 300), prePassRate };
  }

  // 3. Create branch + apply + commit. Never target main.
  const slug = spec.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const branch = `wb-improver/${slug}-${Date.now()}`;
  let r = await run("git", ["checkout", "-b", branch]);
  if (r.code !== 0) {
    await fs.rm(patchPath, { force: true }).catch(() => {});
    return { outcome: "apply-failed", message: `git checkout -b: ${r.stderr.trim().slice(0, 200)}`, prePassRate };
  }
  r = await run("git", ["apply", patchPath]);
  if (r.code !== 0) {
    // Revert to whatever we were on.
    await run("git", ["checkout", "-"]);
    await run("git", ["branch", "-D", branch]);
    await fs.rm(patchPath, { force: true }).catch(() => {});
    return { outcome: "apply-failed", message: `git apply: ${r.stderr.trim().slice(0, 200)}`, prePassRate };
  }
  await run("git", ["add", "-A"]);
  await run("git", ["commit", "-m", `improver: ${spec.name} attempt 1\n\nDiff proposed by workbook-improve --auto. Re-run pending.`]);
  await fs.rm(patchPath, { force: true }).catch(() => {});

  // 4. Re-run the spec at pass^k to measure post-improvement state.
  // We do this in-process via runEval (no subprocess), so we capture
  // the same shape we measured pre.
  const { runEval } = await import("./runner.mjs");
  const { consoleReporter } = await import("./reporter.mjs");
  const reporter = consoleReporter();
  const postRuns = [];
  for (let i = 0; i < passK; i++) {
    const summary = await runEval(spec, { reporter });
    postRuns.push(summary);
  }
  const postPassRate = postRuns.filter((r) => r.pass).length / passK;
  const preRate = prePassRate ?? 0;

  let outcome;
  if (postPassRate === 1) outcome = "converged";
  else if (postPassRate > preRate) outcome = "improved";
  else if (postPassRate < preRate) outcome = "regressed";
  else outcome = "no-change";

  // 5. On regression, hard-revert the commit so the branch is a
  // visible trail of "we tried this; it made things worse."
  if (outcome === "regressed") {
    await run("git", ["revert", "--no-edit", "HEAD"]);
  }

  return {
    outcome,
    branch,
    prePassRate: preRate,
    postPassRate,
    attempts: 1,
    postRuns: postRuns.map((r) => r.pass),
  };
}

export async function improveFailingSpecs(summaries, opts = {}) {
  const failing = summaries.filter((s) => !s.pass);
  if (failing.length === 0) {
    process.stdout.write(`\n# improve: no failing specs — nothing to do\n`);
    return;
  }

  process.stdout.write(`\n# improve: ${failing.length} failing spec(s); proposing diffs\n\n`);

  for (const summary of failing) {
    process.stdout.write(`# ========================================\n`);
    process.stdout.write(`# spec: ${summary.spec.name}\n`);
    process.stdout.write(`# agent: ${summary.spec.agent}\n`);
    if (summary.reliability) {
      process.stdout.write(`# reliability: ${summary.reliability.passes}/${summary.reliability.k} pass [${summary.reliability.bucket}]\n`);
    }
    process.stdout.write(`# ========================================\n\n`);

    const ctx = await gatherContext(summary, opts);
    const rawDiff = await spawnImprover(ctx);
    const repaired = await repairHunkHeaders(rawDiff, ctx.agentSourceExcerpt);

    process.stdout.write(repaired);
    process.stdout.write("\n\n");

    if (opts.auto) {
      const prePassRate = summary.reliability
        ? summary.reliability.passes / summary.reliability.k
        : (summary.pass ? 1 : 0);
      process.stdout.write(`# improve --auto: applying diff + re-running at pass^k=3\n`);
      const result = await autoApplyAndRetry({
        spec: summary.spec,
        diff: repaired,
        prePassRate,
        passK: opts.passK ?? 3,
      });
      process.stdout.write(`\n# improve --auto outcome: ${result.outcome}\n`);
      process.stdout.write(`#   pre  pass-rate: ${(result.prePassRate * 100).toFixed(0)}%\n`);
      process.stdout.write(`#   post pass-rate: ${(result.postPassRate * 100).toFixed(0)}%\n`);
      if (result.branch) {
        process.stdout.write(`#   branch: ${result.branch}\n`);
      }
      if (result.message) {
        process.stdout.write(`#   note: ${result.message}\n`);
      }
      if (result.outcome === "converged") {
        process.stdout.write(`# ✓ converged — review the branch and merge if you accept it\n`);
      } else if (result.outcome === "regressed") {
        process.stdout.write(`# ✗ regressed — branch has the failed attempt + a revert commit\n`);
      } else if (result.outcome === "improved") {
        process.stdout.write(`# · improved but not green — re-run --auto for another iteration\n`);
      } else if (result.outcome === "no-change") {
        process.stdout.write(`# · no measurable change — try a different fix angle\n`);
      } else {
        process.stdout.write(`# ✗ apply failed — review the diff and apply manually if appropriate\n`);
      }
    }
  }
}

async function gatherContext(summary, opts) {
  const spec = summary.spec;
  // Pick the most recent failing run to draw trace + judge verdict from.
  const failedRun = (summary.runs ?? [summary]).filter((r) => !r.pass).at(-1)
    ?? (summary.runs ?? [summary]).at(-1);

  const judgeFindings = collectJudgeFindings(failedRun);
  const specSource = await readSpecSource(spec.sourcePath);
  const agentSource = await readAgentSource(spec.agent);

  return {
    specName: spec.name,
    agentSlug: spec.agent,
    specSource,
    agentSourceExcerpt: agentSource.excerpt,
    agentSourcePath: agentSource.path,
    judgeFindings,
    sessionId: failedRun?.sessionId ?? null,
    keepConfig: opts.keepClone === true,
  };
}

function collectJudgeFindings(run) {
  const found = [];
  if (!run?.turnResults) return found;
  for (const t of run.turnResults) {
    if (!Array.isArray(t.checks)) continue;
    for (const c of t.checks) {
      if (c.check?.kind !== "rubric.passes") continue;
      if (c.result?.ok && !c.result?.skipped) continue; // only the failures
      found.push({
        rubric: String(c.check?.rubric ?? "").slice(0, 1200),
        message: c.result?.message ?? null,
        reasoning: c.result?.detail?.reasoning ?? null,
        competing_view: c.result?.detail?.competing_view ?? null,
        bias_audit: c.result?.detail?.bias_audit ?? null,
        skipped: Boolean(c.result?.skipped),
        gated: c.result?.reason === "gated",
      });
    }
  }
  return found;
}

async function readSpecSource(sourcePath) {
  try { return await fs.readFile(sourcePath, "utf8"); }
  catch { return "(could not read spec source)"; }
}

async function readAgentSource(agentSlug) {
  // Iteration 1: only workhorse is supported. Read the catalog file
  // and extract the systemPrompt for the requested agent. For now we
  // return the full file as the excerpt — improver decides what
  // section is relevant.
  if (agentSlug === "workhorse" || agentSlug === "default") {
    try {
      const repoRoot = path.resolve(HERE, "..", "..", "..", "..", "..", "..");
      const fullPath = path.resolve(repoRoot, WORKHORSE_MANIFEST_PATH);
      const content = await fs.readFile(fullPath, "utf8");
      return { path: WORKHORSE_MANIFEST_PATH, excerpt: content };
    } catch (err) {
      return { path: WORKHORSE_MANIFEST_PATH, excerpt: `(could not read ${WORKHORSE_MANIFEST_PATH}: ${err.message})` };
    }
  }
  return {
    path: null,
    excerpt: `(no manifest-source resolver for agent slug "${agentSlug}" yet — iteration 1 supports workhorse only)`,
  };
}

function buildImproverPrompt(ctx) {
  const judgeLines = ctx.judgeFindings.length === 0
    ? "(no judge findings — likely a gate failure rather than a rubric miss)"
    : ctx.judgeFindings.map((f, i) => [
        `Finding ${i + 1}:`,
        f.gated ? "  GATED (upstream gate failure)" : "",
        f.skipped && !f.gated ? "  SKIPPED" : "",
        f.message ? `  verdict: ${f.message}` : "",
        f.reasoning ? `  reasoning: ${f.reasoning}` : "",
        f.competing_view ? `  competing view: ${f.competing_view}` : "",
        f.bias_audit ? `  bias audit: ${f.bias_audit}` : "",
      ].filter(Boolean).join("\n")).join("\n\n");

  // Diff-first prompt (wb-xpgr.6.1). Earlier version asked for a long
  // 6-step analysis preamble before the diff, which consumed the
  // model's response budget — analysis arrived, diff truncated. Here
  // the DIFF is the primary output and the objective-thinking
  // workflow lives inline as diff-header comments. The model can't
  // run out of tokens before emitting the diff because the diff IS
  // the response.
  return [
    "You are an improver agent for the workbooks evaluation framework.",
    "Pull the objective-thinking skill — your work is judging and",
    "proposing changes, not generating.",
    "",
    "Your output MUST be ONLY a unified diff against the agent source,",
    "starting with `--- a/<path>` and `+++ b/<path>`. No prose before,",
    "no prose after. The diff is `git apply`-able as-is.",
    "",
    "Put the objective-thinking workflow INLINE as comment lines at",
    "the top of the diff (lines starting with `# `), BEFORE the first",
    "`--- a/...` marker. Use this shape:",
    "",
    "  # failure: <one-sentence root cause>",
    "  # alt-A: <fix shape>",
    "  # alt-B: <competing fix shape>",
    "  # choice: A (or B). reasoning: <one sentence>",
    "  # adversarial: <what would falsify this fix>",
    "  # --- a/path/to/file",
    "  # +++ b/path/to/file",
    "  # @@ ...",
    "  # ...diff body...",
    "",
    "Hard constraints:",
    "  - Modify the AGENT's source. NEVER the spec.",
    `  - The diff MUST target the file path stated below in the`,
    `    "=== AGENT SOURCE: <path> ===" block (literally ${ctx.agentSourcePath}).`,
    "    The `--- a/<path>` and `+++ b/<path>` lines must use that exact path.",
    "    Do not invent a different file path, even if you recognize one",
    "    in the content. The system prompt lives INSIDE the file we gave",
    "    you — patch that file, not a referenced one.",
    "  - The fix is surgical, not a rewrite — keep the diff under 80 lines.",
    "  - Generate 2 distinct alternatives internally; the diff only shows",
    "    the chosen one, but the comment header names both.",
    "  - Do not include backticks, code fences, or any wrapping. The diff",
    "    is bare-text starting with `# failure:`.",
    "  - Match the EXACT whitespace, indentation, and content of the source",
    "    in the context lines (lines starting with ` `). If the context",
    "    doesn't match what's actually in the source file, `git apply`",
    "    fails and your work is wasted.",
    "",
    `=== SPEC: ${ctx.specName} ===`,
    ctx.specSource.slice(0, 3000),
    "",
    "=== JUDGE FINDINGS ===",
    judgeLines,
    "",
    `=== AGENT SOURCE: ${ctx.agentSourcePath ?? "(unknown)"} ===`,
    ctx.agentSourceExcerpt.length > 10_000
      ? ctx.agentSourceExcerpt.slice(0, 10_000) + "\n... (truncated)"
      : ctx.agentSourceExcerpt,
    "",
    "Begin your response with the line `# failure:` and end with the",
    "last line of the diff. No other content.",
  ].join("\n");
}

function spawnImprover(ctx) {
  const prompt = buildImproverPrompt(ctx);
  return new Promise((resolve, reject) => {
    const [spawnCmd, spawnArgs] = spawnArgsForWorkbook([
      "chat", "workhorse", prompt,
      "--runtime", "linux-sandbox",
      "--json",
    ]);
    const child = spawn(spawnCmd, spawnArgs, { stdio: ["ignore", "pipe", "pipe"], env: process.env });

    let stdoutBuf = "";
    let stderrBuf = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdoutBuf += d; });
    child.stderr.on("data", (d) => { stderrBuf += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`improver chat exited ${code}: ${stderrBuf.trim().slice(0, 200)}`));
        return;
      }
      // Reassemble assistant text from the streamed events.
      const byResponse = new Map();
      for (const line of stdoutBuf.split("\n")) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.kind !== "message_delta") continue;
        const rid = e.payload?.responseId ?? `delta-${e._id}`;
        const text = typeof e.payload?.text === "string" ? e.payload.text : "";
        const prev = byResponse.get(rid);
        if (!prev || text.length > prev.length) byResponse.set(rid, text);
      }
      const text = [...byResponse.values()].join("\n\n");
      resolve(text || "(improver returned no text — check sandbox / model state)");
    });
  });
}
