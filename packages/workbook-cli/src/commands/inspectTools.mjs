// `workbook inspect-tools <file.html>` — print the tool manifest
// embedded in a compiled workbook artifact. Reads the
// `<script id="wb-capabilities">` block; returns exit 1 when absent.

import { promises as fs } from "node:fs";
import { extractCapabilities } from "../bundle/capabilities.mjs";

export async function runInspectTools(opts) {
  const inPath = opts._?.[0];
  if (!inPath) {
    throw new Error("usage: workbook inspect-tools <file.html> [--json]");
  }
  const html = await fs.readFile(inPath, "utf8");
  const tools = extractCapabilities(html);
  if (!tools) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ path: inPath, tools: null }) + "\n");
    } else {
      process.stdout.write(`${inPath}: no wb-capabilities block\n`);
    }
    process.exit(1);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ path: inPath, tools }) + "\n");
    return;
  }

  process.stdout.write(`${inPath} — ${tools.length} tool(s)\n`);
  for (const t of tools) {
    const name = typeof t?.name === "string" ? t.name : "(unnamed)";
    const desc = typeof t?.description === "string" ? t.description : "";
    const runtime = typeof t?.runtime === "string" ? ` [${t.runtime}]` : "";
    process.stdout.write(`  ${name}${runtime}\n`);
    if (desc) process.stdout.write(`    ${desc}\n`);
  }
}
