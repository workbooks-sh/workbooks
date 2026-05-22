#!/usr/bin/env node
// shape-drift-ok: this file tests the back-compat path where wrapped
// artifacts carry type:"playground" (pre-stage-rename builds).

// Tests for the stage-recursion build-time guard (historical name:
// playground recursion — the check reads both manifest.stage and
// manifest.playground so old + new artifacts both resolve).
//
// Covers:
//   - non-stage config → no-op
//   - playground wrapping non-playground → pass (depth 1)
//   - playground → playground → non-playground → pass (depth 2, one
//     level of playground recursion allowed)
//   - playground → playground → playground → fail with chain in error
//   - unresolvable wraps target → pass with warning (non-fatal)
//   - URL wraps → pass with warning (no remote fetch in v1)

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
  assertPlaygroundRecursion,
  readWorkbookManifest,
  defaultResolveWraps,
} from "../src/checks/stageRecursion.mjs";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(
    `${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`,
  );
  if (ok) pass++;
  else fail++;
}

/**
 * Write a fake built workbook .html with an embedded workbook-spec
 * script. Returns the absolute path.
 */
async function writeFakeArtifact(absPath, manifest) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const spec = { manifest, cells: [], inputs: {} };
  const html =
    `<!doctype html><html><head>` +
    `<script id="workbook-spec" type="application/json">` +
    JSON.stringify(spec) +
    `</script></head><body></body></html>`;
  await fs.writeFile(absPath, html);
  return absPath;
}

function makeWarnSink() {
  const messages = [];
  return { warn: (m) => messages.push(m), messages };
}

async function main() {
  /* 1. non-playground config → no-op */
  {
    const cfg = { type: "spa", slug: "a", root: "/tmp/nonexistent" };
    let ok = false;
    try {
      const r = await assertPlaygroundRecursion(cfg, async () => null, () => {});
      ok = r.depth === 0 && r.chain.length === 0;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("non-playground: no-op", ok);
  }

  /* 2. playground wrapping non-playground → pass */
  {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-pg-"));
    await writeFakeArtifact(path.join(tmp, "b", "dist", "b.html"), {
      slug: "b",
      type: "spa",
    });
    const cfg = {
      type: "playground",
      slug: "a",
      root: path.join(tmp, "a"),
      playground: { wraps: "b" },
    };
    const resolve = async (wraps, fromDir) => {
      if (wraps === "b") return path.join(tmp, "b", "dist", "b.html");
      return null;
    };
    let ok = false;
    let chain = [];
    try {
      const r = await assertPlaygroundRecursion(cfg, resolve, () => {});
      ok = r.depth === 1;
      chain = r.chain;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("playground → spa: passes", ok, { chain });
    await fs.rm(tmp, { recursive: true, force: true });
  }

  /* 3. playground → playground → non-playground → pass (1 level allowed) */
  {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-pg-"));
    const bPath = path.join(tmp, "b", "dist", "b.html");
    const cPath = path.join(tmp, "c", "dist", "c.html");
    await writeFakeArtifact(bPath, {
      slug: "b",
      type: "playground",
      playground: { wraps: "c" },
    });
    await writeFakeArtifact(cPath, { slug: "c", type: "spa" });
    const cfg = {
      type: "playground",
      slug: "a",
      root: path.join(tmp, "a"),
      playground: { wraps: "b" },
    };
    const resolve = async (wraps) => {
      if (wraps === "b") return bPath;
      if (wraps === "c") return cPath;
      return null;
    };
    let ok = false;
    let chain = [];
    try {
      const r = await assertPlaygroundRecursion(cfg, resolve, () => {});
      ok = r.depth === 2 && r.chain.length === 3;
      chain = r.chain;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("playground → playground → spa: passes (one layer allowed)", ok, {
      chain,
    });
    await fs.rm(tmp, { recursive: true, force: true });
  }

  /* 4. playground → playground → playground → fail with chain */
  {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-pg-"));
    const bPath = path.join(tmp, "b", "dist", "b.html");
    const cPath = path.join(tmp, "c", "dist", "c.html");
    const dPath = path.join(tmp, "d", "dist", "d.html");
    await writeFakeArtifact(bPath, {
      slug: "b",
      type: "playground",
      playground: { wraps: "c" },
    });
    await writeFakeArtifact(cPath, {
      slug: "c",
      type: "playground",
      playground: { wraps: "d" },
    });
    await writeFakeArtifact(dPath, { slug: "d", type: "spa" });
    const cfg = {
      type: "playground",
      slug: "a",
      root: path.join(tmp, "a"),
      playground: { wraps: "b" },
    };
    const resolve = async (wraps) => {
      if (wraps === "b") return bPath;
      if (wraps === "c") return cPath;
      if (wraps === "d") return dPath;
      return null;
    };
    let threw = false;
    let msg = "";
    try {
      await assertPlaygroundRecursion(cfg, resolve, () => {});
    } catch (e) {
      threw = true;
      msg = e.message;
    }
    check("3-level playground chain: fails", threw);
    check("error mentions recursion limit", msg.includes("recursion limit exceeded"));
    check("error includes max depth", msg.includes("max depth 1"));
    check("error names slug 'a' in chain", msg.includes("a"));
    check("error names slug 'b' in chain", msg.includes("b"));
    check("error names slug 'c' in chain", msg.includes("c"));
    check("error uses arrow separator", msg.includes("→"));
    await fs.rm(tmp, { recursive: true, force: true });
  }

  /* 5. unresolvable wraps target → pass with warning */
  {
    const cfg = {
      type: "playground",
      slug: "a",
      root: "/tmp/wb-not-real",
      playground: { wraps: "missing-slug" },
    };
    const sink = makeWarnSink();
    let ok = false;
    try {
      const r = await assertPlaygroundRecursion(
        cfg,
        async () => null,
        sink.warn,
      );
      ok = r.depth === 0;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("unresolvable target: passes", ok);
    check(
      "unresolvable target: emits warning",
      sink.messages.some((m) => m.includes("cannot resolve wraps target")),
    );
  }

  /* 6. URL wraps target → defaultResolveWraps returns null (skip) */
  {
    const cfg = {
      type: "playground",
      slug: "a",
      root: "/tmp/wb-not-real",
      playground: { wraps: "https://example.com/x.html" },
    };
    const sink = makeWarnSink();
    let ok = false;
    try {
      const r = await assertPlaygroundRecursion(
        cfg,
        defaultResolveWraps,
        sink.warn,
      );
      ok = r.depth === 0;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("URL wraps: passes (skipped, no remote fetch)", ok);
    check(
      "URL wraps: emits warning",
      sink.messages.some((m) => m.includes("cannot resolve wraps target")),
    );
  }

  /* 7. defaultResolveWraps finds sibling dist/<slug>.html layout */
  {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-pg-"));
    const bPath = path.join(tmp, "b", "dist", "b.html");
    await writeFakeArtifact(bPath, { slug: "b", type: "spa" });
    const fromDir = path.join(tmp, "a");
    await fs.mkdir(fromDir, { recursive: true });
    const resolved = await defaultResolveWraps("b", fromDir);
    check("defaultResolveWraps: finds sibling layout", resolved === bPath, {
      resolved,
    });
    await fs.rm(tmp, { recursive: true, force: true });
  }

  /* 8. readWorkbookManifest parses embedded spec */
  {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-pg-"));
    const p = path.join(tmp, "x.html");
    await writeFakeArtifact(p, {
      slug: "x",
      type: "playground",
      playground: { wraps: "y" },
    });
    const m = await readWorkbookManifest(p);
    check("readWorkbookManifest: type", m?.type === "playground");
    check("readWorkbookManifest: slug", m?.slug === "x");
    check("readWorkbookManifest: wraps", m?.wraps === "y");
    await fs.rm(tmp, { recursive: true, force: true });
  }

  /* 9. readWorkbookManifest: missing file returns null */
  {
    const m = await readWorkbookManifest("/tmp/definitely-not-here.html");
    check("readWorkbookManifest: missing file → null", m === null);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(2);
});
