#!/usr/bin/env node
// Compatibility shim — observability moved to @work.books/workbench.
// New canonical entry: `workbench observe <id>` or `workbook observe <id>`.

import { runObserve } from "@work.books/workbench/observe";

const argv = process.argv.slice(2);
const flags = { _: [] };
const BOOL = new Set(["json", "raw"]);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const k = a.slice(2);
      if (BOOL.has(k)) { flags[k] = true; continue; }
      const next = argv[i + 1];
      flags[k] = (next == null || next.startsWith("--")) ? true : (i++, next);
    }
  } else {
    flags._.push(a);
  }
}

try {
  await runObserve(flags);
} catch (err) {
  process.stderr.write(`workbook-observe: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
}
