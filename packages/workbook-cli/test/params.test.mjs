#!/usr/bin/env node
// wb-22u.10 — params script tag round-trip test (mirror of capabilities).

import { extractParams } from "../src/bundle/params.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++; else fail++;
}

const params = {
  hue: { type: "number", minimum: 0, maximum: 360, default: 180 },
  mode: { type: "string", enum: ["a", "b"], default: "a" },
};
const html =
  `<!doctype html><html><head>` +
  `<script id="wb-params" type="application/x-workbook-params"` +
  ` data-version="1" data-param-count="2">${JSON.stringify(params)}</script>` +
  `</head><body></body></html>`;

const out = extractParams(html);
check("extract: returns object", out !== null && typeof out === "object" && !Array.isArray(out));
check("extract: param count matches", out && Object.keys(out).length === 2);
check("extract: hue preserved", out?.hue?.type === "number" && out?.hue?.minimum === 0);
check("extract: enum preserved", Array.isArray(out?.mode?.enum) && out.mode.enum.length === 2);

check("extract: null on missing tag", extractParams(`<html><body>nope</body></html>`) === null);
check("extract: null on malformed json",
  extractParams(`<script id="wb-params">not json</script>`) === null);
check("extract: null on array json",
  extractParams(`<script id="wb-params">[1,2]</script>`) === null);

console.log("\n──────────────────────────────────────────────");
console.log(`PASS: ${pass}   FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
