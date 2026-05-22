#!/usr/bin/env node
// wb-umxd.3 — vision-mode rubric.passes test harness.
//
// Verifies:
//   - text-only fallback when codex isn't on PATH
//   - vision path extracts frames at expected timestamps and passes
//     them as --image flags to a PATH-stubbed `codex` binary
//   - direct image_paths bypass extraction
//
// Soft-skips ffmpeg/ffprobe-dependent cases when the binaries aren't
// installed (same convention as test/eval-checks-wavelet.test.mjs).

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

import { rubricChecks } from "../src/eval/checks/rubric.mjs";

let pass = 0, fail = 0, skipped = 0;
function check(name, ok, detail) {
  if (ok === "skip") {
    console.log(`- ${name}  (skip: ${detail})`);
    skipped++;
    return;
  }
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++; else fail++;
}

function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

const HAVE_FFMPEG = which("ffmpeg");
const HAVE_FFPROBE = which("ffprobe");

async function makeTmp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), `rubric-vision-${prefix}-`));
}

async function generateTinyMp4(outPath, color = "red", durSecs = 6) {
  const r = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=${color}:s=64x64:d=${durSecs}`,
    "-pix_fmt", "yuv420p",
    outPath,
  ], { encoding: "utf8" });
  return r.status === 0;
}

// Make a PATH-stub `codex` script that records the args it was called
// with (to `argLog`) and writes a fixed verdict via --output-last-message.
async function makeCodexStub(dir, argLog, verdictJson) {
  const stub = path.join(dir, "codex");
  // Bash script: parse --output-last-message <file>, write verdict to it,
  // then write all args (one per line) to argLog.
  const script = `#!/usr/bin/env bash
# Record every arg, one per line.
: > "${argLog}"
for a in "$@"; do
  printf '%s\\n' "$a" >> "${argLog}"
done
# Find --output-last-message <FILE> and write the verdict.
out=""
i=1
for a in "$@"; do
  if [ "$a" = "--output-last-message" ]; then
    eval "next=\\\${$((i+1))}"
    out="$next"
    break
  fi
  i=$((i+1))
done
if [ -n "$out" ]; then
  printf '%s' '${verdictJson.replace(/'/g, "'\\''")}' > "$out"
fi
exit 0
`;
  await fs.writeFile(stub, script, { mode: 0o755 });
  return stub;
}

async function withPathPrefix(dir, fn) {
  const orig = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${orig}`;
  try { return await fn(); }
  finally { process.env.PATH = orig; }
}

async function withPathStripped(stripFilter, fn) {
  // Remove any directory whose contents the filter rejects.
  const orig = process.env.PATH;
  const cleaned = orig
    .split(path.delimiter)
    .filter((d) => {
      if (!d) return false;
      try {
        const items = require("node:fs").readdirSync(d);
        return !items.some((i) => stripFilter(i));
      } catch {
        return true;
      }
    })
    .join(path.delimiter);
  process.env.PATH = cleaned;
  try { return await fn(); }
  finally { process.env.PATH = orig; }
}

// ----------------------------------------------------------------------
// 1. Text-only fallback when codex isn't on PATH.
// ----------------------------------------------------------------------

await (async () => {
  // Use an empty PATH so codex resolves to nothing.
  const orig = process.env.PATH;
  process.env.PATH = "/nonexistent-dir-for-rubric-vision-test";
  try {
    const r = await rubricChecks["rubric.passes"](
      { events: [{ kind: "message_delta", ts: 1, _id: "a", payload: { text: "I did the thing." } }] },
      {
        rubric: "Pass if the agent claims it did the thing.",
        attachments: { image_paths: ["/tmp/some-image-that-doesnt-need-to-exist.png"] },
        minScore: 0.5,
      },
    );
    // Should fail because codex isn't on PATH AND the result is a failure
    // verdict (no codex → judge can't run). But the fallback path should
    // surface a clear "judge failed" message rather than crashing.
    check("text-only-fallback: no codex on PATH yields clear judge failure",
      r.ok === false && /judge/i.test(r.message ?? ""),
      r.message);
  } finally {
    process.env.PATH = orig;
  }
})();

// ----------------------------------------------------------------------
// 2. Vision path: mp4 → ffmpeg frame extraction → codex with --image
//    (verify the codex was invoked with the right --image args).
// ----------------------------------------------------------------------

await (async () => {
  if (!HAVE_FFMPEG || !HAVE_FFPROBE) {
    check("vision: extracts frames at evenly-spaced timestamps", "skip", "ffmpeg/ffprobe not on PATH");
    check("vision: codex invoked with --image per frame", "skip", "ffmpeg/ffprobe not on PATH");
    return;
  }
  const tmp = await makeTmp("v");
  const mp4 = path.join(tmp, "tiny.mp4");
  if (!await generateTinyMp4(mp4, "red", 6)) {
    check("vision: extracts frames at evenly-spaced timestamps", "skip", "ffmpeg synth failed");
    return;
  }

  const stubDir = await makeTmp("stub");
  const argLog = path.join(stubDir, "args.log");
  await makeCodexStub(stubDir, argLog,
    `{"pass": true, "score": 0.85, "reasoning": "frames show red color matching brief", "competing_view": "could be off-brand red", "bias_audit": "checked for charity drift"}`);

  const r = await withPathPrefix(stubDir, () =>
    rubricChecks["rubric.passes"](
      { events: [{ kind: "message_delta", ts: 1, _id: "a", payload: { text: "Rendered red commercial." } }] },
      {
        rubric: "Pass if the rendered video shows red.",
        attachments: { mp4_path: mp4 },
        minScore: 0.7,
      },
    ),
  );
  check("vision: judge passes with stub verdict", r.ok, r.message);

  // Inspect arg log to verify --image flags were passed (3 frames default).
  const argText = await fs.readFile(argLog, "utf8");
  const imageArgs = argText.split("\n").filter((a) => a.startsWith("/") && a.endsWith(".png"));
  check("vision: codex invoked with 3 --image flags (default temporal sampling)",
    imageArgs.length === 3,
    { imageCount: imageArgs.length, sample: imageArgs.slice(0, 3) });

  // Verify the timestamps embedded in the filenames are roughly
  // [0.5, duration/2=3, duration-0.5=5.5] for a 6s clip.
  const tsFromName = imageArgs.map((p) => {
    const m = /frame-\d+-([\d.]+)\.png$/.exec(p);
    return m ? parseFloat(m[1]) : NaN;
  });
  const okTs =
    tsFromName.length === 3 &&
    Math.abs(tsFromName[0] - 0.5) < 0.05 &&
    Math.abs(tsFromName[1] - 3.0) < 0.2 &&
    Math.abs(tsFromName[2] - 5.5) < 0.2;
  check("vision: timestamps clamped to [0.5, dur/2, dur-0.5]",
    okTs, { tsFromName });
})();

// ----------------------------------------------------------------------
// 3. Explicit frame_at_secs overrides the default sampler.
// ----------------------------------------------------------------------

await (async () => {
  if (!HAVE_FFMPEG || !HAVE_FFPROBE) {
    check("vision: explicit frame_at_secs is honored", "skip", "ffmpeg/ffprobe not on PATH");
    return;
  }
  const tmp = await makeTmp("v2");
  const mp4 = path.join(tmp, "tiny.mp4");
  if (!await generateTinyMp4(mp4, "blue", 4)) {
    check("vision: explicit frame_at_secs is honored", "skip", "ffmpeg synth failed");
    return;
  }

  const stubDir = await makeTmp("stub2");
  const argLog = path.join(stubDir, "args.log");
  await makeCodexStub(stubDir, argLog,
    `{"pass": true, "score": 0.9, "reasoning": "ok", "competing_view": "n/a", "bias_audit": "n/a"}`);

  const r = await withPathPrefix(stubDir, () =>
    rubricChecks["rubric.passes"](
      { events: [{ kind: "message_delta", ts: 1, _id: "a", payload: { text: "Rendered." } }] },
      {
        rubric: "Pass.",
        attachments: { mp4_path: mp4, frame_at_secs: [1.0, 2.5] },
        minScore: 0.5,
      },
    ),
  );
  check("vision: explicit frame_at_secs passes", r.ok, r.message);

  const argText = await fs.readFile(argLog, "utf8");
  const imageArgs = argText.split("\n").filter((a) => a.endsWith(".png"));
  const tsFromName = imageArgs.map((p) => {
    const m = /frame-\d+-([\d.]+)\.png$/.exec(p);
    return m ? parseFloat(m[1]) : NaN;
  });
  check("vision: explicit frame_at_secs yields exactly those timestamps",
    tsFromName.length === 2 &&
      Math.abs(tsFromName[0] - 1.0) < 0.01 &&
      Math.abs(tsFromName[1] - 2.5) < 0.01,
    { tsFromName });
})();

// ----------------------------------------------------------------------
// 4. image_paths bypass: no mp4, just direct png paths.
// ----------------------------------------------------------------------

await (async () => {
  const tmp = await makeTmp("ip");
  // Create a tiny valid PNG (8-byte sig + minimum chunks). Easier: just
  // an empty file — the test only verifies the path is forwarded.
  const png = path.join(tmp, "fake.png");
  await fs.writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const stubDir = await makeTmp("stub3");
  const argLog = path.join(stubDir, "args.log");
  await makeCodexStub(stubDir, argLog,
    `{"pass": true, "score": 0.8, "reasoning": "ok", "competing_view": "n/a", "bias_audit": "n/a"}`);

  const r = await withPathPrefix(stubDir, () =>
    rubricChecks["rubric.passes"](
      { events: [{ kind: "message_delta", ts: 1, _id: "a", payload: { text: "x" } }] },
      {
        rubric: "Pass.",
        attachments: { image_paths: [png] },
        minScore: 0.5,
      },
    ),
  );
  check("vision: direct image_paths bypass extraction", r.ok, r.message);

  const argText = await fs.readFile(argLog, "utf8");
  const imageArgs = argText.split("\n").filter((a) => a === png);
  check("vision: direct image_paths forwarded as --image",
    imageArgs.length === 1, { count: imageArgs.length });
})();

// ----------------------------------------------------------------------

console.log(`\n${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fail > 0) process.exit(1);
