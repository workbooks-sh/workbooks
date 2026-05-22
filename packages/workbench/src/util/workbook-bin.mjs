// Locate the `workbook` CLI entry script that Workbench subprocess-spawns.
//
// Workbench lives in @work.books/workbench but drives @work.books/cli
// (workbook chat / git / session). After the package split the relative
// "../../bin/workbook.mjs" path no longer resolves, so consumers go
// through this helper instead.
//
// Resolution order:
//   1. $WORKBOOK_BIN override (absolute path to a workbook.mjs entry)
//   2. require.resolve("@work.books/cli/bin/workbook.mjs") — the
//      workspace symlink picks up local edits without an npm cycle
//   3. `workbook` on $PATH (last-resort; honors installed shims)

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

let cached = null;

export function resolveWorkbookBin() {
  if (cached) return cached;

  const envOverride = process.env.WORKBOOK_BIN;
  if (envOverride && envOverride.length > 0) {
    cached = envOverride;
    return cached;
  }

  try {
    cached = require.resolve("@work.books/cli/bin/workbook.mjs");
    return cached;
  } catch {
    // fall through
  }

  // Last resort: look for `workbook` on PATH. We return the binary
  // name itself; callers pass it as argv[0] for spawn() without
  // process.execPath. Mark with a sentinel so callers know to spawn
  // it directly rather than via node.
  cached = { onPath: true, name: "workbook" };
  return cached;
}

export async function resolveWorkbookBinAsync() {
  return resolveWorkbookBin();
}

// Helper: build argv for spawn(). Returns [cmd, args] tuple.
// If we resolved to a node script, prepend process.execPath; if we
// resolved a PATH binary, spawn it directly.
export function spawnArgsForWorkbook(args) {
  const bin = resolveWorkbookBin();
  if (typeof bin === "string") {
    return [process.execPath, [bin, ...args]];
  }
  return [bin.name, args];
}
