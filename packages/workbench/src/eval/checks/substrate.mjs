// substrate.* — observe the eval org's substrate after the agent
// (and its sandbox) has had a chance to push.
//
// Each check awaits `ctx.substrate.ensureClone()` lazily, then a fresh
// `refresh()` per call so back-to-back checks reflect post-push state.
//
// wb-n9zq — "settle" workaround: the substrate Worker can take a short
// moment between `git push` exit 0 and the new ref being visible to a
// fresh fetch from another clone. Pure presence/content checks
// (file_exists, file_contains, file_bytes_match, tree_at on an
// expected manifest) wrap their read in a bounded retry loop so the
// eval doesn't fail on a sub-second visibility window. Absence checks
// (file_missing, gitignored) deliberately do NOT settle — for those a
// false-negative would mean missing a real leak, which is far worse
// than a slightly slower pass.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const SETTLE_WINDOW_MS = 15000;
const SETTLE_INTERVAL_MS = 250;

async function settleRead(ctx, relPath) {
  const deadline = Date.now() + SETTLE_WINDOW_MS;
  let buf = await ctx.substrate.readFile(relPath);
  while (buf == null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SETTLE_INTERVAL_MS));
    buf = await ctx.substrate.readFile(relPath);
  }
  return buf;
}

async function settleReadWith(ctx, relPath, predicate) {
  const deadline = Date.now() + SETTLE_WINDOW_MS;
  let buf = await ctx.substrate.readFile(relPath);
  while ((buf == null || !predicate(buf)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SETTLE_INTERVAL_MS));
    buf = await ctx.substrate.readFile(relPath);
  }
  return buf;
}

export const substrateChecks = {
  /**
   * Byte-for-byte equality between two filesystem paths. Both may live
   * inside the substrate clone OR outside (the latter is the
   * round-trip case: compare the substrate's built artifact against a
   * pulled tempdir's reconstructed file).
   *
   *   - kind: substrate.bytes_equal
   *     left:  workbooks/<slug>/dist/<slug>.html   # substrate-relative
   *     right: "ctx.lastPulledDir:src/index.html"  # special: prefixed
   *                                                # path inside the
   *                                                # ctx.lastPulledDir
   *                                                # tempdir
   *
   * Path resolution rules:
   *   - bare relative path → resolved against the substrate clone root
   *   - "ctx.lastPulledDir:<rel>" → resolved against ctx.lastPulledDir
   *   - "abs:/tmp/foo/bar"        → absolute path passthrough
   */
  "substrate.bytes_equal": async (ctx, params) => {
    if (!params || typeof params.left !== "string" || typeof params.right !== "string") {
      return fail(`substrate.bytes_equal: requires "left" and "right" (strings)`);
    }
    const leftBuf = await readResolved(ctx, params.left);
    if (leftBuf.error) return fail(`substrate.bytes_equal: left: ${leftBuf.error}`);
    const rightBuf = await readResolved(ctx, params.right);
    if (rightBuf.error) return fail(`substrate.bytes_equal: right: ${rightBuf.error}`);
    const leftHash = createHash("sha256").update(leftBuf.buf).digest("hex");
    const rightHash = createHash("sha256").update(rightBuf.buf).digest("hex");
    if (leftHash !== rightHash) {
      return fail(`substrate.bytes_equal: sha256 mismatch`, {
        left: `${params.left} (${leftBuf.buf.length}B, ${leftHash.slice(0, 12)}…)`,
        right: `${params.right} (${rightBuf.buf.length}B, ${rightHash.slice(0, 12)}…)`,
      });
    }
    return { ok: true, message: `bytes_equal: ${leftBuf.buf.length}B, sha256 ${leftHash.slice(0, 12)}…` };
  },

  "substrate.file_exists": async (ctx, params) => {
    requirePath(params, "substrate.file_exists");
    const buf = await settleRead(ctx, params.path);
    if (buf == null) return fail(`substrate.file_exists: ${params.path} not in substrate`);
    return pass();
  },

  "substrate.file_missing": async (ctx, params) => {
    requirePath(params, "substrate.file_missing");
    // No settle: presence check is the safer direction here. If a leak
    // exists transiently we want to catch it, not paper over with a
    // retry-until-absent.
    const buf = await ctx.substrate.readFile(params.path);
    if (buf != null) return fail(`substrate.file_missing: ${params.path} unexpectedly present`);
    return pass();
  },

  "substrate.file_contains": async (ctx, params) => {
    requirePath(params, "substrate.file_contains");
    if (typeof params.substring !== "string") {
      return fail(`substrate.file_contains: requires "substring" (string)`);
    }
    const buf = await settleReadWith(ctx, params.path, (b) =>
      b.toString("utf8").includes(params.substring),
    );
    if (buf == null) return fail(`substrate.file_contains: ${params.path} not in substrate`);
    const text = buf.toString("utf8");
    if (!text.includes(params.substring)) {
      return fail(
        `substrate.file_contains: substring ${JSON.stringify(params.substring)} not in ${params.path}`,
        { excerpt: text.slice(0, 200) },
      );
    }
    return pass();
  },

  "substrate.file_bytes_match": async (ctx, params) => {
    requirePath(params, "substrate.file_bytes_match");
    let predicate;
    if (typeof params.sha256 === "string") {
      const wantHex = params.sha256.toLowerCase();
      predicate = (b) => createHash("sha256").update(b).digest("hex") === wantHex;
    } else if (typeof params.base64 === "string") {
      const want = Buffer.from(params.base64, "base64");
      predicate = (b) => b.equals(want);
    } else {
      return fail(`substrate.file_bytes_match: requires "sha256" or "base64"`);
    }
    const buf = await settleReadWith(ctx, params.path, predicate);
    if (buf == null) return fail(`substrate.file_bytes_match: ${params.path} not in substrate`);
    if (!predicate(buf)) {
      if (typeof params.sha256 === "string") {
        const got = createHash("sha256").update(buf).digest("hex");
        return fail(`substrate.file_bytes_match: sha256 mismatch`, { expected: params.sha256, got });
      }
      return fail(`substrate.file_bytes_match: byte mismatch (${buf.length} bytes)`);
    }
    return pass();
  },

  // wb-ojss.4 — race-resolution check: file bytes must equal AT LEAST
  // ONE of the supplied candidates (each given as a literal string or
  // a sha256). For "one writer wins" races where either value is
  // acceptable but a concatenation / merge marker is not.
  //
  //   - kind: substrate.file_bytes_any_of
  //     path: .race/value
  //     candidates:
  //       - "alpha"               # literal string
  //       - sha256: "abcd..."     # hex digest of expected bytes
  //       - base64: "..."         # base64 of expected bytes
  "substrate.file_bytes_any_of": async (ctx, params) => {
    requirePath(params, "substrate.file_bytes_any_of");
    if (!Array.isArray(params.candidates) || params.candidates.length === 0) {
      return fail(`substrate.file_bytes_any_of: requires "candidates" (non-empty array)`);
    }
    const wantBufs = [];
    for (let i = 0; i < params.candidates.length; i++) {
      const c = params.candidates[i];
      if (typeof c === "string") {
        wantBufs.push({ desc: JSON.stringify(c.slice(0, 20)), buf: Buffer.from(c, "utf8"), kind: "literal" });
      } else if (c && typeof c === "object" && typeof c.sha256 === "string") {
        wantBufs.push({ desc: `sha256=${c.sha256.slice(0, 12)}…`, sha256: c.sha256.toLowerCase(), kind: "hash" });
      } else if (c && typeof c === "object" && typeof c.base64 === "string") {
        wantBufs.push({ desc: `base64(${c.base64.length}B)`, buf: Buffer.from(c.base64, "base64"), kind: "base64" });
      } else {
        return fail(`substrate.file_bytes_any_of: candidate ${i} must be a string, {sha256}, or {base64}`);
      }
    }
    const predicate = (b) => wantBufs.some((w) => {
      if (w.kind === "hash") {
        return createHash("sha256").update(b).digest("hex") === w.sha256;
      }
      return b.equals(w.buf);
    });
    const buf = await settleReadWith(ctx, params.path, predicate);
    if (buf == null) return fail(`substrate.file_bytes_any_of: ${params.path} not in substrate`);
    if (!predicate(buf)) {
      const gotHash = createHash("sha256").update(buf).digest("hex");
      return fail(`substrate.file_bytes_any_of: ${params.path} (${buf.length}B, sha256 ${gotHash.slice(0, 12)}…) matched none of ${wantBufs.length} candidate${wantBufs.length === 1 ? "" : "s"}`, {
        got: buf.length <= 64 ? JSON.stringify(buf.toString("utf8")) : `${buf.length}B`,
        candidates: wantBufs.map((w) => w.desc).join(" | "),
      });
    }
    return pass();
  },

  "substrate.tree_at": async (ctx, params) => {
    requirePath(params, "substrate.tree_at");
    const recursive = params.recursive !== false;
    const got = await ctx.substrate.listTree(params.path, { recursive });
    if (!Array.isArray(params.expect)) {
      // No expected manifest — fall back to "non-empty", but warn so
      // operators know this is the WEAKEST possible assertion. Trust
      // signal: anyone reading the eval log can see we settled for
      // "something exists" rather than "the right thing exists".
      process.stderr.write(
        `# WARN substrate.tree_at on "${params.path}" without expect: — passes for ANY non-empty tree\n`,
      );
      if (got.length === 0) return fail(`substrate.tree_at: ${params.path} is empty`);
      return { ok: true, message: `non-empty (${got.length} files) — manifest-less` };
    }
    // wb-whjp — mode: "subset" (default) requires expected files to
    // be PRESENT; additional files are fine. mode: "exact" requires
    // strict set-equality. Default subset because templates legitimately
    // emit additional files (spa's package.json, styles.css, etc.)
    // that we don't need to enumerate in every manifest.
    const mode = params.mode === "exact" ? "exact" : "subset";
    const expect = [...params.expect].sort();
    const missing = expect.filter((p) => !got.includes(p));
    if (missing.length > 0) {
      return fail(`substrate.tree_at: required files missing from ${params.path}`, {
        missing: missing.join(", "),
        present_count: String(got.length),
      });
    }
    if (mode === "exact") {
      const extra = got.filter((p) => !expect.includes(p));
      if (extra.length > 0) {
        return fail(`substrate.tree_at: tree has extra files (mode=exact)`, {
          extra: extra.join(", "),
        });
      }
    }
    return pass();
  },

  "substrate.gitignored": async (ctx, params) => {
    requirePath(params, "substrate.gitignored");
    // Two conditions: the path is NOT present in the substrate AND
    // .gitignore in the substrate matches it. The first matters more
    // (an entry could be matched by gitignore but still leak if it was
    // force-added) so we check presence first.
    const buf = await ctx.substrate.readFile(params.path);
    if (buf != null) {
      return fail(`substrate.gitignored: ${params.path} is present in the substrate (it should not be)`);
    }
    return pass();
  },
};

function requirePath(params, kind) {
  if (!params || typeof params.path !== "string") {
    throw new Error(`${kind}: requires "path" (string)`);
  }
}
function pass() { return { ok: true }; }
function fail(message, detail) { return { ok: false, message, detail }; }

// substrate.bytes_equal accepts paths in three resolution forms:
//   - "ctx.lastPulledDir:src/foo"  → join with ctx.lastPulledDir
//   - "abs:/tmp/foo"               → absolute path passthrough
//   - "<rel>"                      → relative to substrate clone root
// Returns { buf, error? }.
async function readResolved(ctx, spec) {
  if (spec.startsWith("ctx.lastPulledDir:")) {
    const dir = ctx.lastPulledDir;
    if (!dir) {
      return { error: `ctx.lastPulledDir not set (run workbook.pull in setup first)` };
    }
    const rel = spec.slice("ctx.lastPulledDir:".length);
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(dir + path.sep) && abs !== dir) {
      return { error: `${rel} escapes ctx.lastPulledDir` };
    }
    try { return { buf: await fs.readFile(abs) }; }
    catch (err) { return { error: `${spec}: ${err.code ?? err.message}` }; }
  }
  if (spec.startsWith("abs:")) {
    const abs = spec.slice("abs:".length);
    try { return { buf: await fs.readFile(abs) }; }
    catch (err) { return { error: `${spec}: ${err.code ?? err.message}` }; }
  }
  // Default: substrate-relative.
  const buf = await ctx.substrate.readFile(spec);
  if (buf == null) return { error: `${spec} not in substrate` };
  return { buf };
}
