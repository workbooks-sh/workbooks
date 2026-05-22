// wavelet.* — programmatic gates against wavelet video pipeline output.
// All are deterministic (gates, per EVAL_PRINCIPLES.md #2): file probes,
// cost summaries, workflow-state, palette-feature presence, frame pixel
// sampling, and C2PA verification.
//
// Each surfaces SPECIFIC evidence in failure messages — the actual
// duration, the actual hex sampled, the missing palette features —
// so the improver loop has falsifiable detail to act on.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export const waveletChecks = {
  /**
   * wavelet.video_renders — probe an mp4 via ffprobe; assert codec /
   * duration / dims match. Surfaces actual values on failure.
   *
   *   - kind: wavelet.video_renders
   *     path: dist/final.mp4
   *     duration_secs: 15
   *     duration_tolerance_secs: 0.5
   *     width: 1080
   *     height: 1920
   *     codec: h264
   */
  "wavelet.video_renders": async (_ctx, params) => {
    if (!params || typeof params.path !== "string") {
      return fail(`wavelet.video_renders: requires "path" (string)`);
    }
    const tol = typeof params.duration_tolerance_secs === "number" ? params.duration_tolerance_secs : 0.5;
    const codec = params.codec ?? "h264";
    try {
      await fs.access(params.path);
    } catch {
      return fail(`wavelet.video_renders: file not found: ${params.path}`);
    }
    const probe = await runCmd("ffprobe", [
      "-v", "error",
      "-show_format",
      "-show_streams",
      "-print_format", "json",
      params.path,
    ]);
    if (probe.code !== 0) {
      return fail(`wavelet.video_renders: ffprobe failed (exit ${probe.code})`, { stderr: probe.stderr.slice(0, 400) });
    }
    let info;
    try {
      info = JSON.parse(probe.stdout);
    } catch (err) {
      return fail(`wavelet.video_renders: ffprobe stdout not JSON: ${err.message}`);
    }
    const video = (info.streams || []).find((s) => s.codec_type === "video");
    if (!video) {
      return fail(`wavelet.video_renders: no video stream in ${params.path}`);
    }
    const actualCodec = video.codec_name;
    const actualW = video.width;
    const actualH = video.height;
    const actualDuration = parseFloat(info.format?.duration ?? video.duration ?? "0");
    const evidence = {
      path: params.path,
      codec: actualCodec,
      width: actualW,
      height: actualH,
      duration_secs: actualDuration,
    };
    if (actualCodec !== codec) {
      return fail(`wavelet.video_renders: codec mismatch — expected ${codec}, got ${actualCodec}`, evidence);
    }
    if (typeof params.width === "number" && actualW !== params.width) {
      return fail(`wavelet.video_renders: width mismatch — expected ${params.width}, got ${actualW}`, evidence);
    }
    if (typeof params.height === "number" && actualH !== params.height) {
      return fail(`wavelet.video_renders: height mismatch — expected ${params.height}, got ${actualH}`, evidence);
    }
    if (typeof params.duration_secs === "number") {
      const diff = Math.abs(actualDuration - params.duration_secs);
      if (diff > tol) {
        return fail(
          `wavelet.video_renders: duration ${actualDuration.toFixed(3)}s outside ±${tol}s of expected ${params.duration_secs}s`,
          evidence,
        );
      }
    }
    return { ok: true, message: `video_renders: ${actualCodec} ${actualW}x${actualH} ${actualDuration.toFixed(2)}s` };
  },

  /**
   * wavelet.cost_below — sum cost_estimate_usd across a JSONL trace.
   *
   *   - kind: wavelet.cost_below
   *     trace: cache/wavelet.trace.jsonl
   *     max_usd: 2.50
   */
  "wavelet.cost_below": async (_ctx, params) => {
    if (!params || typeof params.trace !== "string") {
      return fail(`wavelet.cost_below: requires "trace" (string)`);
    }
    if (typeof params.max_usd !== "number") {
      return fail(`wavelet.cost_below: requires "max_usd" (number)`);
    }
    let raw;
    try {
      raw = await fs.readFile(params.trace, "utf8");
    } catch (err) {
      return fail(`wavelet.cost_below: trace not readable: ${params.trace} (${err.code ?? err.message})`);
    }
    const entries = [];
    let total = 0;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const cost = typeof obj.cost_estimate_usd === "number" ? obj.cost_estimate_usd : 0;
      if (cost > 0) {
        total += cost;
        entries.push({ line: i + 1, cost, label: obj.command ?? obj.tool ?? obj.stage ?? obj.action ?? "(unlabeled)" });
      }
    }
    const top = [...entries].sort((a, b) => b.cost - a.cost).slice(0, 3);
    const breakdown = top.map((e) => `$${e.cost.toFixed(4)} ${e.label}`).join("; ");
    if (total > params.max_usd) {
      return fail(
        `wavelet.cost_below: total $${total.toFixed(4)} exceeds budget $${params.max_usd.toFixed(2)} (${entries.length} calls)`,
        { total_usd: total, max_usd: params.max_usd, top3: breakdown },
      );
    }
    return { ok: true, message: `cost_below: $${total.toFixed(4)} / $${params.max_usd.toFixed(2)} across ${entries.length} calls` };
  },

  /**
   * wavelet.workflow_complete — run `wavelet workflow run <pipeline>` and
   * assert all stages are complete.
   *
   *   - kind: wavelet.workflow_complete
   *     workdir: ./
   *     pipeline: commercial
   */
  "wavelet.workflow_complete": async (_ctx, params) => {
    if (!params || typeof params.workdir !== "string") {
      return fail(`wavelet.workflow_complete: requires "workdir" (string)`);
    }
    const pipeline = params.pipeline ?? "commercial";
    // Use WAVELET_REAL (set by wavelet.commercial action) before falling
    // back to PATH — the eval workdir's .bin/ shim is gone by the time
    // checks run, and the user's PATH may not include wavelet.
    const waveletBin = process.env.WAVELET_REAL ?? "wavelet";
    const res = await runCmd(waveletBin, ["workflow", "run", pipeline, "--workdir", params.workdir]);
    if (res.code !== 0) {
      return fail(`wavelet.workflow_complete: wavelet exited ${res.code}`, { stderr: res.stderr.slice(0, 400) });
    }
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (err) {
      return fail(`wavelet.workflow_complete: stdout not JSON: ${err.message}`, { stdout: res.stdout.slice(0, 200) });
    }
    const stages = Array.isArray(parsed.stages) ? parsed.stages : [];
    const firstIncomplete = stages.find((s) => s.status !== "complete");
    if (firstIncomplete) {
      return fail(
        `wavelet.workflow_complete: stage "${firstIncomplete.name}" status=${firstIncomplete.status}`,
        { next_stage: parsed.next_stage, stage_count: stages.length },
      );
    }
    if (parsed.complete !== true) {
      return fail(`wavelet.workflow_complete: complete=${parsed.complete} (expected true)`, { next_stage: parsed.next_stage });
    }
    if (parsed.next_stage !== null && parsed.next_stage !== undefined) {
      return fail(`wavelet.workflow_complete: next_stage="${parsed.next_stage}" (expected null)`);
    }
    return { ok: true, message: `workflow_complete: ${stages.length} stages all complete` };
  },

  /**
   * wavelet.palette_uses — grep required features across globbed HTML.
   *
   *   - kind: wavelet.palette_uses
   *     workdir: ./
   *     scenes_glob: scenes/*.html
   *     required: ["mix-blend-mode", "clip-path", "@keyframes", "<video"]
   */
  "wavelet.palette_uses": async (_ctx, params) => {
    if (!params || !Array.isArray(params.required) || params.required.length === 0) {
      return fail(`wavelet.palette_uses: requires "required" (non-empty string array)`);
    }
    const glob = params.scenes_glob ?? "scenes/*.html";
    const baseDir = params.workdir ? path.resolve(params.workdir) : process.cwd();
    const files = await resolveGlob(baseDir, glob);
    if (files.length === 0) {
      return fail(`wavelet.palette_uses: no files matched ${glob} under ${baseDir}`);
    }
    const hitCounts = Object.fromEntries(params.required.map((f) => [f, 0]));
    for (const file of files) {
      let text;
      try { text = await fs.readFile(file, "utf8"); }
      catch { continue; }
      for (const feature of params.required) {
        const count = substringCount(text, feature);
        hitCounts[feature] += count;
      }
    }
    const missing = params.required.filter((f) => hitCounts[f] === 0);
    if (missing.length > 0) {
      return fail(
        `wavelet.palette_uses: missing features across ${files.length} file(s): ${missing.map((f) => JSON.stringify(f)).join(", ")}`,
        { hits: hitCounts, files_scanned: files.length },
      );
    }
    const summary = Object.entries(hitCounts).map(([k, v]) => `${k}=${v}`).join(", ");
    return { ok: true, message: `palette_uses: ${files.length} file(s); ${summary}` };
  },

  /**
   * wavelet.frame_probe — sample one pixel from one frame of an mp4.
   *
   *   - kind: wavelet.frame_probe
   *     mp4: dist/final.mp4
   *     t_secs: 1.0
   *     x: 100
   *     y: 100
   *     expect:
   *       hex_close_to: "#ff0000"
   *       tolerance: 30
   *       min_alpha: 200
   */
  "wavelet.frame_probe": async (_ctx, params) => {
    if (!params || typeof params.mp4 !== "string") {
      return fail(`wavelet.frame_probe: requires "mp4" (string)`);
    }
    if (typeof params.t_secs !== "number" || typeof params.x !== "number" || typeof params.y !== "number") {
      return fail(`wavelet.frame_probe: requires "t_secs", "x", "y" (numbers)`);
    }
    const expect = params.expect ?? {};
    const tol = typeof expect.tolerance === "number" ? expect.tolerance : 30;
    try { await fs.access(params.mp4); }
    catch { return fail(`wavelet.frame_probe: file not found: ${params.mp4}`); }
    // Extract a single frame as RGBA raw bytes. We need to know the
    // exact frame dimensions to index the buffer; ffprobe gives them.
    const probe = await runCmd("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-print_format", "json",
      params.mp4,
    ]);
    if (probe.code !== 0) {
      return fail(`wavelet.frame_probe: ffprobe failed (exit ${probe.code})`, { stderr: probe.stderr.slice(0, 400) });
    }
    let dims;
    try {
      const j = JSON.parse(probe.stdout);
      dims = j.streams?.[0];
    } catch (err) {
      return fail(`wavelet.frame_probe: ffprobe stdout not JSON: ${err.message}`);
    }
    if (!dims || !dims.width || !dims.height) {
      return fail(`wavelet.frame_probe: could not read dimensions from ${params.mp4}`);
    }
    const w = dims.width, h = dims.height;
    if (params.x < 0 || params.x >= w || params.y < 0 || params.y >= h) {
      return fail(`wavelet.frame_probe: (${params.x},${params.y}) out of bounds for ${w}x${h}`);
    }
    const raw = await runCmd("ffmpeg", [
      "-ss", String(params.t_secs),
      "-i", params.mp4,
      "-vframes", "1",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-",
    ]);
    if (raw.code !== 0) {
      return fail(`wavelet.frame_probe: ffmpeg failed (exit ${raw.code})`, { stderr: raw.stderrStr.slice(0, 400) });
    }
    const buf = raw.stdoutBuf;
    const expectedLen = w * h * 4;
    if (buf.length < expectedLen) {
      return fail(`wavelet.frame_probe: raw frame too small (${buf.length}B; expected ${expectedLen}B for ${w}x${h} RGBA)`);
    }
    const off = (params.y * w + params.x) * 4;
    const r = buf[off], g = buf[off + 1], b = buf[off + 2], a = buf[off + 3];
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const sample = { r, g, b, a, hex };
    if (typeof expect.min_alpha === "number" && a < expect.min_alpha) {
      return fail(`wavelet.frame_probe: alpha ${a} below min_alpha ${expect.min_alpha} at (${params.x},${params.y})`, sample);
    }
    if (Array.isArray(expect.r_range) && (r < expect.r_range[0] || r > expect.r_range[1])) {
      return fail(`wavelet.frame_probe: r=${r} outside [${expect.r_range[0]},${expect.r_range[1]}]`, sample);
    }
    if (Array.isArray(expect.g_range) && (g < expect.g_range[0] || g > expect.g_range[1])) {
      return fail(`wavelet.frame_probe: g=${g} outside [${expect.g_range[0]},${expect.g_range[1]}]`, sample);
    }
    if (Array.isArray(expect.b_range) && (b < expect.b_range[0] || b > expect.b_range[1])) {
      return fail(`wavelet.frame_probe: b=${b} outside [${expect.b_range[0]},${expect.b_range[1]}]`, sample);
    }
    if (typeof expect.hex_close_to === "string") {
      const target = parseHex(expect.hex_close_to);
      if (!target) {
        return fail(`wavelet.frame_probe: hex_close_to "${expect.hex_close_to}" not a valid #rrggbb`);
      }
      const dist = Math.abs(r - target.r) + Math.abs(g - target.g) + Math.abs(b - target.b);
      if (dist > tol * 3) {
        return fail(
          `wavelet.frame_probe: sampled ${hex} too far from ${expect.hex_close_to} (L1=${dist}, tol=${tol * 3}) at (${params.x},${params.y})`,
          sample,
        );
      }
    }
    return { ok: true, message: `frame_probe: ${hex} a=${a} at (${params.x},${params.y}) @ t=${params.t_secs}s` };
  },

  /**
   * wavelet.c2pa_verifies — `wavelet c2pa verify <path>` exits 0.
   *
   *   - kind: wavelet.c2pa_verifies
   *     path: dist/final.mp4
   */
  "wavelet.c2pa_verifies": async (_ctx, params) => {
    if (!params || typeof params.path !== "string") {
      return fail(`wavelet.c2pa_verifies: requires "path" (string)`);
    }
    try { await fs.access(params.path); }
    catch { return fail(`wavelet.c2pa_verifies: file not found: ${params.path}`); }
    const res = await runCmd("wavelet", ["c2pa", "verify", params.path]);
    if (res.code !== 0) {
      return fail(`wavelet.c2pa_verifies: wavelet c2pa verify exited ${res.code}`, {
        path: params.path,
        stderr: res.stderr.slice(0, 600),
        stdout: res.stdout.slice(0, 200),
      });
    }
    return { ok: true, message: `c2pa_verifies: ${params.path} signed and valid` };
  },
};

function pass() { return { ok: true }; }
function fail(message, detail) { return { ok: false, message, detail }; }

function parseHex(s) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function substringCount(haystack, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while (true) {
    const k = haystack.indexOf(needle, i);
    if (k === -1) return n;
    n++;
    i = k + needle.length;
  }
}

// Minimal glob: supports a single `*` in the last segment (e.g.
// `scenes/*.html`) plus exact paths. Anything more exotic should
// graduate to a real glob lib.
async function resolveGlob(baseDir, pattern) {
  const norm = pattern.replace(/^\.\//, "");
  if (!norm.includes("*")) {
    const abs = path.resolve(baseDir, norm);
    try { await fs.access(abs); return [abs]; } catch { return []; }
  }
  const parts = norm.split("/");
  const last = parts.pop();
  const dir = path.resolve(baseDir, parts.join("/"));
  let entries;
  try { entries = await fs.readdir(dir); }
  catch { return []; }
  const re = new RegExp("^" + last.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return entries.filter((e) => re.test(e)).map((e) => path.join(dir, e)).sort();
}

// Run a command, return { code, stdout, stderr, stdoutBuf, stderrStr }.
// stdout is decoded utf8 by default; stdoutBuf is the raw bytes (needed
// for binary pipes like rawvideo frame extraction).
function runCmd(cmd, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err.message ?? err), stdoutBuf: Buffer.alloc(0), stderrStr: String(err.message ?? err) });
      return;
    }
    const outChunks = [];
    const errChunks = [];
    child.stdout.on("data", (d) => outChunks.push(d));
    child.stderr.on("data", (d) => errChunks.push(d));
    child.on("error", (err) => {
      resolve({ code: -1, stdout: "", stderr: String(err.message ?? err), stdoutBuf: Buffer.alloc(0), stderrStr: String(err.message ?? err) });
    });
    child.on("close", (code) => {
      const stdoutBuf = Buffer.concat(outChunks);
      const stderrBuf = Buffer.concat(errChunks);
      resolve({
        code: code ?? -1,
        stdout: stdoutBuf.toString("utf8"),
        stderr: stderrBuf.toString("utf8"),
        stdoutBuf,
        stderrStr: stderrBuf.toString("utf8"),
      });
    });
  });
}
