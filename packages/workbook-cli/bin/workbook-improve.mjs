#!/usr/bin/env node
// Compatibility shim — the iterate-agent loop moved to @work.books/workbench.
// New canonical entry: `workbench improve <spec>` or `workbook improve <spec>`.

import { runImprove } from "@work.books/workbench/improve";

const argv = process.argv.slice(2);
const flags = { _: [] };
const BOOL = new Set(["json", "auto"]);
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
  await runImprove(flags);
} catch (err) {
  process.stderr.write(`workbook-improve: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
}
