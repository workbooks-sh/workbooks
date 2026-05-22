#!/usr/bin/env node
/**
 * Stage example assets into ./examples/ before `npm pack` / `npm
 * publish` reads them out of the files-manifest. Mode is "stage"
 * (default — copies into place) or "clean" (called from postpack
 * to restore a clean tree).
 *
 * The source assets live at packages/workbooks/examples/ relative to
 * this package's root — outside the package tree because they're
 * also consumed by the in-tree dev loop. The CLI's resolveRuntime
 * checks the monorepo location first, then the npm-tarball location
 * (./examples/), so this script's output only matters for the
 * published package.
 *
 * Run via `npm run stage-examples` or automatically through the
 * `prepack` / `postpack` lifecycle scripts. wb-ybw.
 */

import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const SRC_ROOT = resolve(PKG_ROOT, "..", "..", "examples");
const DEST_ROOT = join(PKG_ROOT, "examples");

/** Files the package.json `files` array depends on. Keep this list
 *  in sync with that manifest — if you add a row there, mirror it
 *  here. */
const ASSETS = [
  ["_shared/design.css",            "_shared/design.css"],
  ["_shared/portable.js",           "_shared/portable.js"],
  ["_shared/chrome.js",             "_shared/chrome.js"],
  ["reactive-cells/runtime.bundle.js", "reactive-cells/runtime.bundle.js"],
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

const mode = process.argv[2] === "clean" ? "clean" : "stage";

if (mode === "clean") {
  await rm(DEST_ROOT, { recursive: true, force: true });
  console.log(`[runtime-wasm] removed ${DEST_ROOT}`);
  process.exit(0);
}

let copied = 0;
for (const [src, dest] of ASSETS) {
  const from = join(SRC_ROOT, src);
  const to = join(DEST_ROOT, dest);
  if (!(await exists(from))) {
    console.error(`[runtime-wasm] missing source: ${from}`);
    console.error(
      "  The asset hasn't been built yet. For runtime.bundle.js, run\n" +
      "  the runtime-bundle build (or the reactive-cells dev loop)\n" +
      "  before npm pack/publish.",
    );
    process.exit(1);
  }
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  copied++;
}
console.log(`[runtime-wasm] staged ${copied} example asset${copied === 1 ? "" : "s"} into ${DEST_ROOT}/`);
