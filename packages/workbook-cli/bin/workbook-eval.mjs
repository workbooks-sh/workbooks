#!/usr/bin/env node
// Compatibility shim — the eval framework moved to @work.books/workbench.
// New canonical entry: `workbench eval [path]` or `workbook eval [path]`.
//
// This shim preserves the workbook-eval binary so existing CI / agent
// scripts keep working. wb-zy76.

import { runEvalCmd } from "@work.books/workbench/eval";

const argv = process.argv.slice(2);
const flags = { _: [] };
const BOOL = new Set(["json", "dry", "debug", "keep", "require-all"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const k = a.slice(2);
      if (k.startsWith("no-")) { flags[k.slice(3)] = false; continue; }
      if (BOOL.has(k)) { flags[k] = true; continue; }
      const next = argv[i + 1];
      flags[k] = (next == null || next.startsWith("--")) ? true : (i++, next);
    }
  } else {
    flags._.push(a);
  }
}

try {
  await runEvalCmd(flags);
} catch (err) {
  process.stderr.write(`workbook-eval: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
}
