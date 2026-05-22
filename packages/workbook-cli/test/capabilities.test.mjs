#!/usr/bin/env node
// wb-1ru — capabilities script tag round-trip test.

import { extractCapabilities } from "../src/bundle/capabilities.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++; else fail++;
}

const tools = [
  { name: "lookup", description: "weather", input_schema: { type: "object" }, runtime: "worker" },
];
const html =
  `<!doctype html><html><head>` +
  `<script id="wb-capabilities" type="application/x-workbook-capabilities"` +
  ` data-version="1" data-tool-count="1">${JSON.stringify(tools)}</script>` +
  `</head><body></body></html>`;

const out = extractCapabilities(html);
check("extract: returns array", Array.isArray(out));
check("extract: tool count matches", out?.length === 1);
check("extract: tool name preserved", out?.[0]?.name === "lookup");
check("extract: input_schema preserved", out?.[0]?.input_schema?.type === "object");

const plain = `<html><body>nope</body></html>`;
check("extract: null on missing tag", extractCapabilities(plain) === null);

const malformed =
  `<script id="wb-capabilities" type="application/x-workbook-capabilities">not json</script>`;
check("extract: null on malformed json", extractCapabilities(malformed) === null);

const notArray = `<script id="wb-capabilities">{"name":"x"}</script>`;
check("extract: null on non-array json", extractCapabilities(notArray) === null);

console.log("\n──────────────────────────────────────────────");
console.log(`PASS: ${pass}   FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
