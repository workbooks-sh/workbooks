#!/usr/bin/env node
// wb-q6rb.6 — workbook check lint rule: warn on hardcoded
// `composio:<toolkit>` slugs that point at the deprecated path.
//
// Verifies:
//   - flags double-quoted, single-quoted, and backticked literals
//   - reports line/col at the opening quote
//   - skips a line tagged `workbook-disable-next-line ...`
//   - does NOT flag the bare word "composio" without a slug
//   - does NOT flag prose mentions of composio (e.g., comments)
//     that don't form a `composio:slug` string literal
//   - the rule is registered in the global registry

import { RULES_BY_ID } from "../src/checks/registry.mjs";
import rule from "../src/checks/rules/no-composio-slug.mjs";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++;
  else fail++;
}

const RULE_ID = "workbook/correctness/no-composio-slug";

function run(content, filePath = "workbook.config.mjs") {
  return rule.check({ filePath, content });
}

/* 1. registration */
check("rule is registered under its id", RULES_BY_ID.get(RULE_ID) === rule);
check("rule severity is warn", rule.severity === "warn");
check("rule is not fixable (no auto-rewrite)", rule.fixable === false);

/* 2. flags every quote style */
const allQuotes = `
export default {
  tools: [
    "composio:gmail",
    'composio:slack',
    \`composio:google_drive\`,
  ],
};
`;
const ds = run(allQuotes);
check("flags double-quoted slug", ds.some((d) => d.message.includes("gmail")));
check("flags single-quoted slug", ds.some((d) => d.message.includes("slack")));
check("flags backticked slug", ds.some((d) => d.message.includes("google_drive")));
check("emits one diag per slug", ds.length === 3, ds.length);

/* 3. line/col points at the opening quote */
const oneOnLine3 = "// header\nconst tools = [\n  \"composio:notion\",\n];\n";
const d = run(oneOnLine3)[0];
check("line is 1-indexed (slug is on line 3)", d.line === 3, d.line);
check(
  "col points at the opening quote",
  oneOnLine3.split("\n")[d.line - 1].charAt(d.col - 1) === '"',
  { col: d.col, char: oneOnLine3.split("\n")[d.line - 1].charAt(d.col - 1) },
);

/* 4. disable comment is honored */
const suppressed = `
// workbook-disable-next-line workbook/correctness/no-composio-slug
const t = "composio:linear";
`;
check("workbook-disable-next-line suppresses the diag", run(suppressed).length === 0);

/* 5. bare word "composio" without a slug is NOT flagged */
const bareWord = `
// This used to use Composio but we removed it.
const composio_was_here = true;
`;
check("bare word 'composio' without ':slug' is not flagged", run(bareWord).length === 0);

/* 6. prose with "composio:" at end of sentence is not greedy */
// The pattern requires a quote on BOTH sides — comments / prose are
// safe even when they mention "composio:something" without quotes.
const prose = `
// migrate composio:gmail to oauth eventually
const x = 1;
`;
check("prose mentioning composio:slug without quotes is not flagged", run(prose).length === 0);

/* 7. uppercase / mixed case prefix does NOT match (slug convention
       is lowercase; a typo like "Composio:Gmail" probably means the
       user meant something else and we'd rather not silently warn) */
const wrongCase = `const t = "Composio:Gmail";`;
check("uppercase 'Composio:' is not flagged (lowercase convention)", run(wrongCase).length === 0);

console.log("\n──────────────────────────────────────────────");
console.log(`PASS: ${pass}   FAIL: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
