#!/usr/bin/env node
// wb-umxd.1 — wavelet.* check kinds.
//
// Manual test harness, same shape as test/source-bundle.test.mjs and
// test/params.test.mjs. Soft-skips ffmpeg/ffprobe/wavelet-dependent
// cases when the binaries aren't on PATH (CI without media tools
// shouldn't redden the dashboard for env reasons).

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

import { waveletChecks } from "../src/eval/checks/wavelet.mjs";

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
  return fs.mkdtemp(path.join(os.tmpdir(), `wavelet-test-${prefix}-`));
}

async function generateTinyMp4(outPath, color = "red", durSecs = 1) {
  // ffmpeg -y -f lavfi -i color=red:s=64x64:d=1 -pix_fmt yuv420p out.mp4
  const r = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=${color}:s=64x64:d=${durSecs}`,
    "-pix_fmt", "yuv420p",
    outPath,
  ], { encoding: "utf8" });
  return r.status === 0;
}

// Build a PATH-stub script that prints fixed JSON and exits 0/1, so we
// can exercise wavelet.workflow_complete without a real wavelet binary.
async function makeStubBin(dir, name, stdout, exitCode = 0) {
  const p = path.join(dir, name);
  const script = `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(stdout)});
process.exit(${exitCode});
`;
  await fs.writeFile(p, script, { mode: 0o755 });
  return p;
}

async function withPathPrefix(dir, fn) {
  const orig = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${orig}`;
  try { return await fn(); }
  finally { process.env.PATH = orig; }
}

// ----------------------------------------------------------------------
// wavelet.video_renders
// ----------------------------------------------------------------------

await (async () => {
  if (!HAVE_FFMPEG || !HAVE_FFPROBE) {
    check("video_renders: success", "skip", "ffmpeg/ffprobe not on PATH");
    check("video_renders: missing file", "skip", "ffmpeg/ffprobe not on PATH");
    check("video_renders: wrong duration", "skip", "ffmpeg/ffprobe not on PATH");
    return;
  }
  const tmp = await makeTmp("vr");
  const mp4 = path.join(tmp, "tiny.mp4");
  const ok = await generateTinyMp4(mp4, "red", 1);
  if (!ok) {
    check("video_renders: success", "skip", "ffmpeg failed to synthesize fixture");
    return;
  }

  const r1 = await waveletChecks["wavelet.video_renders"]({}, {
    path: mp4,
    duration_secs: 1,
    duration_tolerance_secs: 0.3,
    width: 64,
    height: 64,
    codec: "h264",
  });
  check("video_renders: success", r1.ok, r1.message);

  const r2 = await waveletChecks["wavelet.video_renders"]({}, { path: path.join(tmp, "no-such.mp4") });
  check("video_renders: missing file fails with clear msg",
    !r2.ok && /file not found/.test(r2.message), r2.message);

  const r3 = await waveletChecks["wavelet.video_renders"]({}, {
    path: mp4, duration_secs: 99, duration_tolerance_secs: 0.5,
  });
  check("video_renders: wrong duration fails with actual",
    !r3.ok && /duration/.test(r3.message), r3.message);
})();

// ----------------------------------------------------------------------
// wavelet.cost_below
// ----------------------------------------------------------------------

await (async () => {
  const tmp = await makeTmp("cb");
  const trace = path.join(tmp, "trace.jsonl");
  await fs.writeFile(trace, [
    JSON.stringify({ command: "image.gen", cost_estimate_usd: 0.10 }),
    JSON.stringify({ command: "video.gen", cost_estimate_usd: 0.15 }),
    JSON.stringify({ command: "audio.gen", cost_estimate_usd: 0.05 }),
    "", // empty line, should be skipped
    "not json at all", // malformed, skipped
  ].join("\n"));

  const r1 = await waveletChecks["wavelet.cost_below"]({}, { trace, max_usd: 0.50 });
  check("cost_below: under budget passes", r1.ok, r1.message);

  const r2 = await waveletChecks["wavelet.cost_below"]({}, { trace, max_usd: 0.20 });
  check("cost_below: over budget fails with total + top3",
    !r2.ok && /total \$0\.3000/.test(r2.message) && /video\.gen/.test(r2.detail?.top3 ?? ""),
    { msg: r2.message, top3: r2.detail?.top3 });

  const r3 = await waveletChecks["wavelet.cost_below"]({}, { trace: path.join(tmp, "nope.jsonl"), max_usd: 1 });
  check("cost_below: missing trace fails", !r3.ok && /not readable/.test(r3.message), r3.message);
})();

// ----------------------------------------------------------------------
// wavelet.workflow_complete  (PATH-stub wavelet binary)
// ----------------------------------------------------------------------

await (async () => {
  const tmp = await makeTmp("wc");
  const goodOut = JSON.stringify({
    next_stage: null,
    complete: true,
    stages: [
      { name: "brief", status: "complete" },
      { name: "shots", status: "complete" },
      { name: "render", status: "complete" },
    ],
  });
  const stubDirGood = await makeTmp("stub-good");
  await makeStubBin(stubDirGood, "wavelet", goodOut, 0);
  const r1 = await withPathPrefix(stubDirGood, () =>
    waveletChecks["wavelet.workflow_complete"]({}, { workdir: tmp, pipeline: "commercial" })
  );
  check("workflow_complete: all complete passes", r1.ok, r1.message);

  const badOut = JSON.stringify({
    next_stage: "render",
    complete: false,
    stages: [
      { name: "brief", status: "complete" },
      { name: "shots", status: "complete" },
      { name: "render", status: "pending" },
    ],
  });
  const stubDirBad = await makeTmp("stub-bad");
  await makeStubBin(stubDirBad, "wavelet", badOut, 0);
  const r2 = await withPathPrefix(stubDirBad, () =>
    waveletChecks["wavelet.workflow_complete"]({}, { workdir: tmp, pipeline: "commercial" })
  );
  check("workflow_complete: pending stage fails with stage name",
    !r2.ok && /render/.test(r2.message) && /pending/.test(r2.message), r2.message);
})();

// ----------------------------------------------------------------------
// wavelet.palette_uses
// ----------------------------------------------------------------------

await (async () => {
  const tmp = await makeTmp("pu");
  const scenes = path.join(tmp, "scenes");
  await fs.mkdir(scenes, { recursive: true });
  await fs.writeFile(path.join(scenes, "01.html"),
    `<!doctype html><style>.x { mix-blend-mode: screen; clip-path: circle(50%); }
@keyframes pulse { from { opacity: 0; } } </style><video src="a.mp4"></video>`);
  await fs.writeFile(path.join(scenes, "02.html"),
    `<!doctype html><style>.y { mix-blend-mode: overlay; }</style>`);

  const r1 = await waveletChecks["wavelet.palette_uses"]({}, {
    workdir: tmp,
    scenes_glob: "scenes/*.html",
    required: ["mix-blend-mode", "clip-path", "@keyframes", "<video"],
  });
  check("palette_uses: all features present", r1.ok, r1.message);

  const r2 = await waveletChecks["wavelet.palette_uses"]({}, {
    workdir: tmp,
    scenes_glob: "scenes/*.html",
    required: ["mix-blend-mode", "filter: url(#noise)"],
  });
  check("palette_uses: missing feature fails with which is missing",
    !r2.ok && /filter: url\(#noise\)/.test(r2.message), r2.message);

  const r3 = await waveletChecks["wavelet.palette_uses"]({}, {
    workdir: tmp,
    scenes_glob: "no-such/*.html",
    required: ["x"],
  });
  check("palette_uses: zero-match glob fails clearly",
    !r3.ok && /no files matched/.test(r3.message), r3.message);
})();

// ----------------------------------------------------------------------
// wavelet.frame_probe
// ----------------------------------------------------------------------

await (async () => {
  if (!HAVE_FFMPEG || !HAVE_FFPROBE) {
    check("frame_probe: red mp4 returns red", "skip", "ffmpeg/ffprobe not on PATH");
    check("frame_probe: hex tolerance violation surfaces hex", "skip", "ffmpeg/ffprobe not on PATH");
    return;
  }
  const tmp = await makeTmp("fp");
  const mp4 = path.join(tmp, "red.mp4");
  const ok = await generateTinyMp4(mp4, "red", 1);
  if (!ok) {
    check("frame_probe: red mp4 returns red", "skip", "ffmpeg synth failed");
    return;
  }
  // ffmpeg "color=red" → roughly #ff0000 after yuv420p round-trip.
  // Use a generous tolerance since chroma subsampling drifts the
  // exact bytes.
  const r1 = await waveletChecks["wavelet.frame_probe"]({}, {
    mp4, t_secs: 0.1, x: 32, y: 32,
    expect: { hex_close_to: "#ff0000", tolerance: 40 },
  });
  check("frame_probe: red mp4 reads red", r1.ok, r1.message);

  const r2 = await waveletChecks["wavelet.frame_probe"]({}, {
    mp4, t_secs: 0.1, x: 32, y: 32,
    expect: { hex_close_to: "#00ff00", tolerance: 10 },
  });
  check("frame_probe: green expected on red mp4 fails with actual hex",
    !r2.ok && /#/.test(r2.message), r2.message);
})();

// ----------------------------------------------------------------------
// wavelet.c2pa_verifies  (PATH-stub wavelet binary)
// ----------------------------------------------------------------------

await (async () => {
  const tmp = await makeTmp("c2");
  const mp4 = path.join(tmp, "stub.mp4");
  await fs.writeFile(mp4, "not really an mp4"); // file just has to exist

  const stubDirOk = await makeTmp("stub-c2-ok");
  await makeStubBin(stubDirOk, "wavelet", "verified ok\n", 0);
  const r1 = await withPathPrefix(stubDirOk, () =>
    waveletChecks["wavelet.c2pa_verifies"]({}, { path: mp4 })
  );
  check("c2pa_verifies: exit 0 passes", r1.ok, r1.message);

  // Stub that prints to stderr and exits 1. We can't easily emit
  // stderr from the simple node stub, so use a shell stub.
  const stubDirBad = await makeTmp("stub-c2-bad");
  const badStub = path.join(stubDirBad, "wavelet");
  await fs.writeFile(badStub, `#!/bin/sh
echo "manifest invalid: leaf cert expired" 1>&2
exit 2
`, { mode: 0o755 });
  const r2 = await withPathPrefix(stubDirBad, () =>
    waveletChecks["wavelet.c2pa_verifies"]({}, { path: mp4 })
  );
  check("c2pa_verifies: non-zero exit fails with stderr",
    !r2.ok && /exited 2/.test(r2.message) && /manifest invalid/.test(r2.detail?.stderr ?? ""),
    { msg: r2.message, stderr: r2.detail?.stderr });

  const r3 = await waveletChecks["wavelet.c2pa_verifies"]({}, { path: path.join(tmp, "no-file.mp4") });
  check("c2pa_verifies: missing file fails before exec",
    !r3.ok && /file not found/.test(r3.message), r3.message);
})();

// ----------------------------------------------------------------------

console.log(`\n${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fail > 0) process.exit(1);
