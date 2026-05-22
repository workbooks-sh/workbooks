// rubric.passes — judge a transcript fragment against a free-form
// rubric using Codex CLI (`codex exec`).
//
// Why Codex CLI:
// - Current frontier OpenAI model (GPT-5 series), not a stale slug.
// - Different family from workhorse (which runs on Claude Opus), so
//   the same-family confirmation-bias risk is mitigated.
// - Subscription-amortized — cost per judge call is fractions of a
//   cent vs. ~$0.05 for an Opus call.
// - No sandbox boot, no workhorse model-override gymnastics.
//   Wall-clock per judge: ~5-15s.
//
// Operator prereq: `codex login` (or a valid ~/.codex/auth.json).
//
// Vision mode (wb-umxd.3): when `attachments` are set, sampled frames
// from the rendered mp4 are extracted with ffmpeg and passed to
// `codex exec --image <path>` so the judge can score against actual
// visual content, not just the agent's narration. Falls back to
// text-only judgement if codex isn't on PATH.

import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import nodeFs from "node:fs";
import path from "node:path";
import os from "node:os";

export const rubricChecks = {
  "rubric.passes": async (ctx, params) => {
    if (!params || typeof params.rubric !== "string") {
      return fail(`rubric.passes: requires "rubric" (string)`);
    }
    const target = params.target ?? "assistant_text";
    const minScore = typeof params.minScore === "number" ? params.minScore : 0.7;

    const excerpt = target === "none" ? "" : extractTarget(ctx, target);
    if (excerpt == null) {
      return fail(`rubric.passes: target ${JSON.stringify(target)} produced no text`);
    }

    // Resolve evidence files — explicit param or sensible defaults from
    // wavelet.commercial's ctx. Each becomes a labeled block in the judge
    // prompt so the rubric can verify per-dimension claims against
    // concrete artifacts (trace, workflow report, notes, meta).
    let evidenceBlocks = [];
    try {
      evidenceBlocks = await collectEvidence(ctx, params.evidence);
    } catch (err) {
      return fail(`rubric.passes: evidence: ${err.message ?? err}`);
    }

    // Resolve attachments → list of image paths to pass to codex.
    let imagePaths = [];
    let visionNotes = [];
    let tempImageDir = null;
    if (params.attachments && typeof params.attachments === "object") {
      try {
        const resolved = await resolveAttachments(ctx, params.attachments, visionNotes);
        imagePaths = resolved.imagePaths;
        tempImageDir = resolved.tempDir;
      } catch (err) {
        return fail(`rubric.passes: attachments: ${err.message ?? err}`);
      }
    }

    // Judge routing: when the spec attaches an mp4, prefer Gemini —
    // it reads the full video natively (temporal coherence, motion,
    // transitions), where Codex only sees N sampled frames. Falls back
    // to Codex if GOOGLE_API_KEY isn't set OR the spec forces it.
    const explicitJudge = typeof params.judge === "string" ? params.judge : null;
    const hasMp4 = Boolean(params.attachments && params.attachments.mp4_path);
    const hasGemini = Boolean(process.env.GOOGLE_API_KEY);
    let backend;
    if (explicitJudge === "gemini") backend = "gemini";
    else if (explicitJudge === "codex") backend = "codex";
    else if (hasMp4 && hasGemini) backend = "gemini";
    else backend = "codex";

    const hasCodex = haveCodex();
    const useVision = backend === "codex" && imagePaths.length > 0 && hasCodex;
    if (backend === "codex" && imagePaths.length > 0 && !hasCodex) {
      visionNotes.push("[text-only-judge] vision not available, judging text only");
    }
    if (backend === "gemini" && !hasGemini) {
      return fail(`rubric.passes: judge=gemini but GOOGLE_API_KEY not set`);
    }

    const judgePrompt = buildJudgePrompt(params.rubric, excerpt, minScore, {
      withImages: useVision,
      imageCount: useVision ? imagePaths.length : 0,
      withVideo: backend === "gemini" && hasMp4,
      evidence: evidenceBlocks,
    });
    let verdict;
    try {
      if (backend === "gemini") {
        const mp4Path = resolveCtxPath(ctx, params.attachments.mp4_path);
        if (!mp4Path) throw new Error(`attachments.mp4_path resolved to nothing`);
        verdict = await invokeGemini(judgePrompt, mp4Path, params.timeoutMs);
      } else {
        verdict = await invokeCodex(judgePrompt, params.timeoutMs, useVision ? imagePaths : []);
      }
    } catch (err) {
      if (tempImageDir) await fs.rm(tempImageDir, { recursive: true, force: true }).catch(() => {});
      return fail(`rubric.passes: judge failed: ${err.message ?? err}`);
    } finally {
      if (tempImageDir) await fs.rm(tempImageDir, { recursive: true, force: true }).catch(() => {});
    }

    if (typeof verdict.score !== "number" && typeof verdict.pass !== "boolean") {
      return fail(`rubric.passes: judge returned no verdict`, {
        raw: JSON.stringify(verdict).slice(0, 200),
      });
    }
    const ok = verdict.pass === true || (typeof verdict.score === "number" && verdict.score >= minScore);
    const visionTag = visionNotes.length > 0
      ? ` ${visionNotes.join(" ")}`
      : backend === "gemini"
        ? ` [gemini: video]`
        : useVision
          ? ` [codex vision: ${imagePaths.length} frames]`
          : "";
    if (!ok) {
      const scoreStr = typeof verdict.score === "number" ? verdict.score.toFixed(2) : "?";
      // Surface the judge's full discipline trace on fail — the
      // operator needs to see what the judge actually audited, not
      // just the verdict.
      const detail = {
        reasoning: (verdict.reasoning ?? "").slice(0, 300),
      };
      if (verdict.competing_view) detail.competing_view = String(verdict.competing_view).slice(0, 200);
      if (verdict.bias_audit) detail.bias_audit = String(verdict.bias_audit).slice(0, 200);
      if (visionNotes.length > 0) detail.vision_notes = visionNotes.join("; ");
      return fail(`rubric.passes: score ${scoreStr} < ${minScore}${visionTag}`, detail);
    }
    const scoreStr = typeof verdict.score === "number" ? verdict.score.toFixed(2) : "pass";
    // Include the competing_view on pass too — it's the evidence the
    // judge considered and rejected. Useful for the improver loop.
    const tail = verdict.competing_view
      ? ` (counter: ${String(verdict.competing_view).slice(0, 60)})`
      : "";
    return { ok: true, message: `judge: ${scoreStr}${visionTag} — ${(verdict.reasoning ?? "").slice(0, 80)}${tail}` };
  },
};

function extractTarget(ctx, target) {
  if (target === "assistant_text") {
    const text = lastAssistantText(ctx.events ?? []);
    // Append a tool-call summary so judges that reason about
    // "did the agent call X?" can actually see the evidence. Without
    // this the judge only sees the agent's final prose, which often
    // doesn't narrate the work — leading to false-negative scores when
    // the agent did the right thing but answered tersely. The summary
    // is bounded to the most recent turn's tool calls; older calls
    // aren't in scope for an `assistant_text` rubric.
    const toolSummary = summarizeRecentToolCalls(ctx.events ?? []);
    if (text && toolSummary) {
      return text + "\n\n---\n[tool-calls during this turn]\n" + toolSummary;
    }
    if (text) return text;
    // Fallback for non-chat agents (codex, claude headless): no
    // message_delta stream — use the transcript file if available.
    return readTranscriptFallback(ctx);
  }
  if (typeof target === "object" && target?.kind === "last_n_turns") {
    return JSON.stringify(ctx.events ?? []).slice(0, 8000);
  }
  if (typeof target === "object" && target?.kind === "turn" && typeof target.index === "number") {
    return JSON.stringify(ctx.events?.filter((e) => e.turnIndex === target.index) ?? []).slice(0, 8000);
  }
  return null;
}

// Summarize tool_start + tool_result events from the most recent turn
// in a compact, judge-readable form: one line per call with name + args
// (truncated). Returns "" if no tool calls happened.
function summarizeRecentToolCalls(events) {
  const last = events
    .filter((e) => e.kind === "tool_start" || e.kind === "tool_result")
    .slice(-30); // hard cap so a runaway turn doesn't blow the budget
  if (last.length === 0) return "";
  const lines = [];
  for (const e of last) {
    if (e.kind === "tool_start") {
      const name = e.payload?.toolName ?? "?";
      let args = "";
      try {
        args = JSON.stringify(e.payload?.args ?? {}).slice(0, 200);
      } catch {
        args = "<unencodable>";
      }
      lines.push(`call ${name}(${args})`);
    } else if (e.kind === "tool_result") {
      const name = e.payload?.toolName ?? "?";
      const status = e.payload?.status ?? "?";
      lines.push(`  → ${name} ${status}`);
    }
  }
  return lines.join("\n");
}

function readTranscriptFallback(ctx) {
  const transcriptPath = ctx.waveletTranscript ?? null;
  if (!transcriptPath) return null;
  try {
    const buf = nodeFs.readFileSync(transcriptPath, "utf8");
    // Trim to the last 8000 chars — judges only need the tail.
    return buf.length > 8000 ? buf.slice(buf.length - 8000) : buf;
  } catch {
    return null;
  }
}

// See session.mjs:lastAssistantText for the rationale. Same fix.
function lastAssistantText(events) {
  const byResponse = new Map();
  for (const e of events) {
    if (e.kind !== "message_delta") continue;
    const text = e.payload?.text;
    if (typeof text !== "string") continue;
    const rid = e.payload?.responseId ?? `delta-${e._id}`;
    const prev = byResponse.get(rid);
    if (!prev) {
      byResponse.set(rid, { firstTs: e.ts, maxText: text });
    } else if (text.length > prev.maxText.length) {
      prev.maxText = text;
    }
  }
  if (byResponse.size === 0) return null;
  const joined = [...byResponse.values()]
    .sort((a, b) => a.firstTs - b.firstTs)
    .map((r) => r.maxText)
    .filter((t) => t.length > 0)
    .join("\n\n");
  return joined.length > 0 ? joined : null;
}

function buildJudgePrompt(rubric, excerpt, minScore, opts = {}) {
  // EVAL_PRINCIPLES.md #8 — judge runs the `objective-thinking` skill.
  // Compact-version workflow + structured output that forces the judge
  // to consider competing views + audit its own bias risks. Defends
  // against charity drift and reward-hacking on rubric language.
  const visionPreamble = opts.withVideo
    ? [
        "NOTE: a video file is attached. Watch the entire clip. Evaluate the",
        "rubric criteria against what is VISIBLE and AUDIBLE in the video as",
        "well as the text excerpt and evidence blocks below.",
        "",
      ]
    : opts.withImages
    ? [
        `NOTE: ${opts.imageCount} image(s) are attached. They are sampled frames`,
        "from the rendered video, in temporal order. Evaluate the rubric criteria",
        "against what is VISIBLE in the frames as well as the text excerpt.",
        "",
      ]
    : [];
  return [
    "You are an objective-thinking judge agent.",
    "",
    ...visionPreamble,
    "Discipline (apply silently before answering):",
    "  - Restate the rubric's pass/fail criteria in your head.",
    "  - Sort the excerpt into: facts (what the response says was done),",
    "    claims (what the response asserts without evidence here), and",
    "    unknowns (what the response doesn't tell you).",
    "  - Generate the strongest case AGAINST your initial verdict —",
    "    `competing_view` captures it.",
    "  - Audit your reasoning for: anchoring on early signals,",
    "    confirmation bias toward the rubric's pass-criteria phrasing,",
    "    premature closure, and unjustified confidence. Surface what",
    "    you tested for in `bias_audit`.",
    "  - Calibrate the score to evidence quality. Confident verdicts",
    "    require concrete evidence; vague excerpts get vague scores.",
    "",
    "Reply with EXACTLY one line: a single JSON object, no commentary,",
    "no code fences.",
    "",
    `Schema: {"pass": <bool>, "score": <0..1>, "reasoning": "<≤120 chars: why>", "competing_view": "<≤80 chars: strongest counter>", "bias_audit": "<≤80 chars: what biases you tested for>"}`,
    "",
    `Pass = score >= ${minScore}.`,
    "",
    "Anti-patterns to refuse:",
    "  - Charity drift: passing because the response 'sounds reasonable'",
    "    without evidence of the rubric's specific criteria.",
    "  - Reward hacking: passing because the response contains the",
    "    rubric's pass-phrases verbatim without doing the underlying work.",
    "",
    "=== RUBRIC ===",
    rubric.trim(),
    "",
    "=== EXCERPT ===",
    excerpt.trim().slice(0, 6000),
    "",
    ...(opts.evidence ?? []).flatMap((block) => [
      `=== EVIDENCE: ${block.label} ===`,
      block.content,
      "",
    ]),
    "=== END ===",
    "",
    "Reply with the JSON object only.",
  ].join("\n");
}

// Resolve the spec's `evidence` param into an array of {label, content}
// blocks. Each entry can be a string path (label defaults to the
// basename), an object {path, label?, max_bytes?}, or undefined (in
// which case we fall back to a sensible default for wavelet.commercial
// runs).
async function collectEvidence(ctx, evidenceParam) {
  let entries = evidenceParam;
  if (entries == null) {
    entries = defaultGamutEvidence(ctx);
  }
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const raw of entries) {
    const entry = typeof raw === "string" ? { path: raw } : raw;
    if (!entry || typeof entry.path !== "string") continue;
    const resolvedPath = resolveEvidencePath(ctx, entry.path);
    if (!resolvedPath) continue;
    let content;
    try {
      content = await fs.readFile(resolvedPath, "utf8");
    } catch {
      continue; // soft-skip missing evidence files
    }
    const maxBytes = typeof entry.max_bytes === "number" ? entry.max_bytes : 4000;
    if (content.length > maxBytes) {
      content = `${content.slice(0, maxBytes)}\n[…truncated ${content.length - maxBytes} bytes]`;
    }
    const label = entry.label ?? path.basename(resolvedPath);
    out.push({ label, content });
  }
  return out;
}

function defaultGamutEvidence(ctx) {
  if (!ctx.waveletRunDir) return [];
  const dir = ctx.waveletRunDir;
  const workdir = ctx.waveletWorkdir ?? path.join(dir, "workdir");
  return [
    { path: ctx.waveletTrace ?? path.join(workdir, ".wavelet-trace.jsonl"), label: "trace.wavelet.jsonl" },
    { path: path.join(workdir, "notes.md"), label: "agent notes.md" },
    { path: path.join(dir, "meta.json"), label: "run meta.json" },
  ];
}

function resolveEvidencePath(ctx, p) {
  // Honor ctx:<key> resolution (same shape as the rest of the harness).
  if (p.startsWith("ctx:")) {
    const key = p.slice(4);
    const value = ctx[key];
    return typeof value === "string" ? value : null;
  }
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

// -------------------------------------------------------------------
// Vision: extract frames + invoke codex with images
// -------------------------------------------------------------------

function haveCodex() {
  // Cheap shell-which; honors PATH so tests can stub via PATH-prefix.
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

async function resolveAttachments(ctx, attachments, notes) {
  const out = { imagePaths: [], tempDir: null };
  // Direct image paths take precedence — no extraction needed.
  if (Array.isArray(attachments.image_paths) && attachments.image_paths.length > 0) {
    for (const p of attachments.image_paths) {
      const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
      try {
        await fs.access(abs);
        out.imagePaths.push(abs);
      } catch {
        notes.push(`[vision] image_path not found: ${p}`);
      }
    }
  }
  // mp4_path → extract frames at frame_at_secs (or compute evenly-spaced).
  if (typeof attachments.mp4_path === "string" && attachments.mp4_path.length > 0) {
    let mp4 = attachments.mp4_path;
    if (!path.isAbsolute(mp4) && ctx.waveletRunDir) {
      mp4 = path.resolve(ctx.waveletRunDir, mp4);
    } else if (!path.isAbsolute(mp4)) {
      mp4 = path.resolve(process.cwd(), mp4);
    }
    try {
      await fs.access(mp4);
    } catch {
      notes.push(`[vision] mp4_path not found: ${attachments.mp4_path}`);
      return out;
    }
    let timestamps = Array.isArray(attachments.frame_at_secs) ? attachments.frame_at_secs.slice() : [];
    if (timestamps.length === 0) {
      const duration = await probeDuration(mp4);
      if (duration == null || duration <= 0) {
        notes.push(`[vision] could not probe duration of ${path.basename(mp4)}`);
        return out;
      }
      timestamps = [
        clamp(0.5, 0, duration),
        clamp(duration / 2, 0, duration),
        clamp(duration - 0.5, 0, duration),
      ];
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `wb-rubric-frames-${process.pid}-`));
    out.tempDir = tmp;
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      const outPath = path.join(tmp, `frame-${i}-${t.toFixed(3)}.png`);
      const ok = await extractFrame(mp4, t, outPath);
      if (ok) {
        out.imagePaths.push(outPath);
        // Surface real timestamp so operator can sanity-check.
        process.stderr.write(`# rubric.passes vision: extracted frame at t=${t.toFixed(3)}s → ${outPath}\n`);
      } else {
        notes.push(`[vision] frame extraction failed at t=${t.toFixed(3)}s`);
      }
    }
  }
  return out;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function probeDuration(mp4) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      mp4,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

function extractFrame(mp4, tSecs, outPath) {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-ss", String(tSecs),
      "-i", mp4,
      "-frames:v", "1",
      "-f", "image2",
      "-vcodec", "png",
      outPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function invokeCodex(prompt, timeoutMs = 120_000, imagePaths = []) {
  const outFile = path.join(os.tmpdir(), `wb-eval-codex-${process.pid}-${Date.now()}.txt`);
  try {
    await runCodex(prompt, outFile, timeoutMs, imagePaths);
    const text = await fs.readFile(outFile, "utf8");
    return parseVerdict(text);
  } finally {
    await fs.rm(outFile, { force: true }).catch(() => {});
  }
}

function runCodex(prompt, outFile, timeoutMs, imagePaths) {
  return new Promise((resolve, reject) => {
    const args = ["exec", "--output-last-message", outFile];
    for (const p of imagePaths) {
      args.push("--image", p);
    }
    args.push("-");
    const child = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      reject(new Error(`codex exec timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdout.on("data", () => { /* discard chatter — we use --output-last-message */ });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`codex exec exited ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      resolve();
    });
    child.stdin.end(prompt);
  });
}

function parseVerdict(text) {
  // Strict parse first.
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); }
    catch { /* fall through */ }
  }
  // Defensive parse — codex sometimes wraps in prose or truncates.
  const passMatch = text.match(/"pass"\s*:\s*(true|false)/);
  const scoreMatch = text.match(/"score"\s*:\s*([0-9]*\.?[0-9]+)/);
  const reasonMatch = text.match(/"reasoning"\s*:\s*"([^"]{0,200})/);
  if (passMatch || scoreMatch) {
    return {
      pass: passMatch ? passMatch[1] === "true" : undefined,
      score: scoreMatch ? Number(scoreMatch[1]) : undefined,
      reasoning: (reasonMatch?.[1] ?? "") + " (recovered from truncated judge response)",
    };
  }
  throw new Error(`judge response had no parseable verdict: ${text.slice(0, 200)}`);
}

function fail(message, detail) {
  return { ok: false, message, detail };
}

function resolveCtxPath(ctx, p) {
  if (typeof p !== "string") return null;
  if (p.startsWith("ctx:")) {
    const key = p.slice(4);
    const value = ctx[key];
    return typeof value === "string" ? value : null;
  }
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

// -------------------------------------------------------------------
// Gemini judge: upload the mp4 via Files API, wait for ACTIVE, then
// generateContent with the video + prompt. Native video understanding
// reads temporal coherence (motion, transitions, audio) that Codex's
// frame-sampling approach misses.
// -------------------------------------------------------------------

// Default judge model — `gemini-3.5-flash` with `thinkingLevel: high`
// is currently better-and-cheaper than `gemini-3.1-pro-preview` for
// evaluative work (per user direction, 2026-05-19). Native video
// understanding still applies. Override with $GEMINI_JUDGE_MODEL if a
// future model regresses on video input or thinking-tier pricing shifts.
const GEMINI_MODEL = process.env.GEMINI_JUDGE_MODEL ?? "gemini-3.5-flash";

async function invokeGemini(prompt, mp4Path, timeoutMs = 180_000) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error(`GOOGLE_API_KEY not set`);
  const buf = await fs.readFile(mp4Path);

  const deadline = Date.now() + timeoutMs;
  const fileUri = await uploadVideoToGemini(buf, mp4Path, apiKey, deadline);
  const verdictText = await generateGeminiVerdict(prompt, fileUri, apiKey, deadline);
  return parseVerdict(verdictText);
}

async function uploadVideoToGemini(buf, mp4Path, apiKey, deadline) {
  // Resumable upload protocol per https://ai.google.dev/api/files#upload
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(buf.length),
        "X-Goog-Upload-Header-Content-Type": "video/mp4",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: path.basename(mp4Path) } }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    },
  );
  if (!startRes.ok) {
    throw new Error(`gemini files upload start ${startRes.status}: ${await startRes.text()}`);
  }
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error(`gemini files upload start: no x-goog-upload-url header`);

  const finalizeRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buf.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buf,
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });
  if (!finalizeRes.ok) {
    throw new Error(`gemini files upload finalize ${finalizeRes.status}: ${await finalizeRes.text()}`);
  }
  const payload = await finalizeRes.json();
  const fileName = payload?.file?.name;
  const fileUri = payload?.file?.uri;
  if (!fileName || !fileUri) throw new Error(`gemini upload: no file.name/uri in response`);

  // Poll until ACTIVE — videos take a moment to process.
  while (Date.now() < deadline) {
    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!pollRes.ok) throw new Error(`gemini files poll ${pollRes.status}`);
    const pollJson = await pollRes.json();
    if (pollJson.state === "ACTIVE") return fileUri;
    if (pollJson.state === "FAILED") throw new Error(`gemini file processing FAILED`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`gemini file did not reach ACTIVE before timeout`);
}

async function generateGeminiVerdict(prompt, fileUri, apiKey, deadline) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        parts: [
          { file_data: { mime_type: "video/mp4", file_uri: fileUri } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "high" },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });
  if (!res.ok) {
    throw new Error(`gemini generateContent ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`gemini: no candidates[0].content.parts[0].text in response`);
  }
  return text;
}
