#!/usr/bin/env node
// wb-4vhr.16 PART 2 — verify embedPlans:
//   * walks src/**/*.org (and only .org files; skips node_modules / .git)
//   * emits one <script type="text/worg"> per file with stable slugs
//   * round-trips raw .org bytes via extractPlans → gunzip
//   * idempotent re-embed (no duplicate blocks)
//   * zero .org files → html unchanged (byte-identical)

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { gunzipSync } from "node:zlib";

import {
  collectOrgFiles,
  buildPlanScript,
  embedPlans,
  extractPlans,
} from "../src/bundle/embedPlans.mjs";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++;
  else fail++;
}

async function makeProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-plans-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "plans"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "fake"), { recursive: true });
  await fs.mkdir(path.join(root, ".git"), { recursive: true });

  await fs.writeFile(path.join(root, "src", "index.html"), "<!doctype html><html><body>hi</body></html>");
  await fs.writeFile(path.join(root, "src", "main.js"), "console.log(1)\n");
  await fs.writeFile(
    path.join(root, "src", "plan.org"),
    [
      "* TODO Top-level plan",
      ":PROPERTIES:",
      ":ID:       p-001",
      ":END:",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "plans", "nested.org"),
    [
      "* TODO Nested plan with unicode — café 日本語 🚀",
      ":PROPERTIES:",
      ":ID:       n-001",
      ":END:",
      "",
    ].join("\n"),
  );
  // Should be ignored:
  await fs.writeFile(path.join(root, "node_modules", "fake", "skipme.org"), "* should not appear");
  await fs.writeFile(path.join(root, ".git", "stash.org"), "* should not appear");
  return root;
}

async function main() {
  const root = await makeProject();

  /* 1. collectOrgFiles — only the two real .org files, sorted */
  const found = await collectOrgFiles(root);
  check("collectOrgFiles: 2 files (no node_modules / .git)", found.length === 2, found.map((f) => f.relPath));
  check("collectOrgFiles: sorted by relPath", found[0].relPath === "src/plan.org" && found[1].relPath === "src/plans/nested.org");

  /* 2. buildPlanScript — slug derived from relPath, raw bytes survive */
  const block = buildPlanScript(found[0].relPath, found[0].source);
  check("buildPlanScript: includes slug from relPath", block.includes('id="workbook-plan-src-plan"'));
  check("buildPlanScript: type=text/worg", block.includes('type="text/worg"'));
  check("buildPlanScript: data-format=raw+gzip+base64", block.includes('data-format="raw+gzip+base64"'));
  check("buildPlanScript: includes data-source-path", block.includes('data-source-path="src/plan.org"'));

  /* 3. embed + extract round-trip for both files */
  const html = "<!doctype html><html><body>hi</body></html>";
  const withPlans = embedPlans(html, found);
  const extracted = extractPlans(withPlans);
  check("extractPlans: returns same number of files", extracted.length === 2);
  // Bytes must be byte-identical post-gunzip.
  const original0 = found[0].source;
  const original1 = found[1].source;
  const recovered0 = gunzipSync(extracted.find((p) => p.sourcePath === "src/plan.org").source);
  const recovered1 = gunzipSync(extracted.find((p) => p.sourcePath === "src/plans/nested.org").source);
  check("round-trip: src/plan.org bytes equal", recovered0.equals(original0));
  check("round-trip: src/plans/nested.org bytes equal (unicode preserved)", recovered1.equals(original1));
  check("round-trip: distinct slugs", extracted[0].id !== extracted[1].id);

  /* 4. idempotent re-embed */
  const reEmbed = embedPlans(withPlans, found);
  const reExtracted = extractPlans(reEmbed);
  check("re-embed: still 2 plan blocks (no duplication)", reExtracted.length === 2);

  /* 5. zero .org files → no mutation (byte-identical) */
  const noPlans = embedPlans(html, []);
  check("zero plans: html unchanged (byte-identical)", noPlans === html);

  /* 6. zero plans on previously-embedded artifact: strips existing blocks */
  const stripped = embedPlans(withPlans, []);
  check("zero plans on existing artifact: blocks stripped", !stripped.includes('id="workbook-plan-'));

  /* 7. block placement: just before </body> */
  check("embedPlans: inserted before </body>", withPlans.indexOf("</body>") > withPlans.indexOf("workbook-plan-"));

  /* 8. fallback when no </body> */
  const noBody = "<!doctype html><html></html>";
  const fallback = embedPlans(noBody, found);
  check("embedPlans: falls back to </html> when no </body>", fallback.indexOf("</html>") > fallback.indexOf("workbook-plan-"));

  await fs.rm(root, { recursive: true, force: true });

  console.log("\n──────────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(2);
});
