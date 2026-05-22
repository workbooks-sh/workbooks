#!/usr/bin/env node
// Synthetic test for the one-workbook-one-iframe build-time invariant.
//
// Covers:
//   - clean projects (no iframes anywhere) pass
//   - author-written iframes (source count == compiled count) pass
//   - simulated pipeline injection (compiled > source) fails loudly
//   - author template-literal iframe in JS still counted in source
//   - error message includes the delta and the source-file list

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
  assertIframeInvariant,
  countSourceIframes,
  countHtmlIframes,
} from "../src/checks/iframeInvariant.mjs";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++;
  else fail++;
}

async function makeProject(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-iframe-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return root;
}

async function main() {
  /* 1. clean: no iframes anywhere → invariant passes */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html><body><div id=app></div></body></html>",
      "src/main.js": "console.log('hi');",
    });
    const compiled = "<!doctype html><html><body><div id=app></div></body></html>";
    let ok = false;
    try {
      const r = await assertIframeInvariant({ projectRoot: root, compiledHtml: compiled });
      ok = r.compiledCount === 0 && r.sourceCount === 0;
    } catch {}
    check("clean project: passes", ok);
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 2. author iframe in HTML: source==1, compiled==1 → passes */
  {
    const root = await makeProject({
      "src/index.html":
        '<!doctype html><html><body><iframe src="https://example.com/embed"></iframe></body></html>',
    });
    const compiled =
      '<!doctype html><html><head></head><body><iframe src="https://example.com/embed"></iframe></body></html>';
    let ok = false;
    try {
      const r = await assertIframeInvariant({ projectRoot: root, compiledHtml: compiled });
      ok = r.sourceCount === 1 && r.compiledCount === 1 && r.delta === 0;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("author iframe (html): passes", ok);
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 3. author iframe in JS template literal: still counted */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html><body></body></html>",
      "src/main.js":
        'const html = `<iframe src="https://example.com"></iframe>`;\n' +
        "document.body.innerHTML = html;\n",
    });
    const compiled =
      "<!doctype html><html><body><script>" +
      'const html = `<iframe src="https://example.com"></iframe>`;' +
      "document.body.innerHTML = html;</script></body></html>";
    let ok = false;
    try {
      const r = await assertIframeInvariant({ projectRoot: root, compiledHtml: compiled });
      ok = r.sourceCount === 1 && r.compiledCount === 1 && r.delta === 0;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("author iframe in JS template literal: counted and passes", ok);
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 4. injection: compiled > source → throws with clear error */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html><body></body></html>",
      "src/main.js": "console.log('hi');",
    });
    // Simulate the pipeline injecting a nested iframe for a "component".
    const compiled =
      '<!doctype html><html><body>' +
      '<iframe id="wb-component-x" srcdoc="…"></iframe>' +
      "</body></html>";
    let threw = false;
    let msg = "";
    try {
      await assertIframeInvariant({ projectRoot: root, compiledHtml: compiled });
    } catch (e) {
      threw = true;
      msg = e.message;
    }
    check("injected iframe: fails the build", threw);
    check(
      "injected iframe: error mentions invariant",
      msg.includes("iframe invariant violated"),
    );
    check("injected iframe: error mentions delta", msg.includes("+1"));
    check(
      "injected iframe: error points to the runtime README",
      msg.includes("packages/runtime/README.md"),
    );
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 5. multiple injections: delta reported correctly */
  {
    const root = await makeProject({
      "src/index.html":
        '<!doctype html><html><body><iframe src="//author.example"></iframe></body></html>',
    });
    const compiled =
      '<!doctype html><html><body>' +
      '<iframe src="//author.example"></iframe>' +
      '<iframe class="injected-1"></iframe>' +
      '<iframe class="injected-2"></iframe>' +
      "</body></html>";
    let threw = false;
    let msg = "";
    try {
      await assertIframeInvariant({ projectRoot: root, compiledHtml: compiled });
    } catch (e) {
      threw = true;
      msg = e.message;
    }
    check("multiple injections: fails", threw);
    check("multiple injections: delta is +2", msg.includes("+2"));
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 6. walker skips node_modules / dist / .git */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html></html>",
      "node_modules/junk/index.js": "<iframe>",
      "dist/old.html": "<iframe>",
      ".git/config": "<iframe>",
    });
    const { total } = await countSourceIframes(root);
    check("walker: ignores node_modules/dist/.git", total === 0, { total });
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 7b. walker excludes workbook.config.{js,mjs} */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html></html>",
      "workbook.config.mjs":
        'export default { vite: { plugins: [{ transformIndexHtml: (h) => h.replace("</body>", "<iframe></iframe></body>") }] } };',
    });
    const { total } = await countSourceIframes(root);
    check(
      "walker: ignores workbook.config.mjs (build-time only)",
      total === 0,
      { total },
    );
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 7c. non-playground: 1 compiled iframe, 0 source → still fails */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html><body></body></html>",
    });
    const compiled =
      '<!doctype html><html><body><iframe id="injected"></iframe></body></html>';
    let threw = false;
    try {
      await assertIframeInvariant({ projectRoot: root, compiledHtml: compiled });
    } catch {
      threw = true;
    }
    check("non-playground: 1 compiled / 0 source still fails", threw);
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 7d. playground: 1 compiled iframe (runtime canvas) → passes with allowance:1 */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html><body></body></html>",
    });
    const compiled =
      '<!doctype html><html><body><iframe id="wb-playground-canvas" sandbox="allow-scripts"></iframe></body></html>';
    let ok = false;
    try {
      const r = await assertIframeInvariant({
        projectRoot: root,
        compiledHtml: compiled,
        allowance: 1,
      });
      ok = r.sourceCount === 0 && r.compiledCount === 1 && r.delta === 0;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("playground: 1 runtime iframe passes with allowance=1", ok);
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 7e. playground: 2 compiled iframes (runtime + injected) → fails with allowance note */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html><body></body></html>",
    });
    const compiled =
      '<!doctype html><html><body>' +
      '<iframe id="wb-playground-canvas"></iframe>' +
      '<iframe id="injected-extra"></iframe>' +
      "</body></html>";
    let threw = false;
    let msg = "";
    try {
      await assertIframeInvariant({
        projectRoot: root,
        compiledHtml: compiled,
        allowance: 1,
      });
    } catch (e) {
      threw = true;
      msg = e.message;
    }
    check("playground: 2 compiled iframes fails even with allowance=1", threw);
    check(
      "playground: error message mentions runtime-emitted allowance",
      msg.includes("playground type already accounts for 1 runtime-emitted iframe"),
    );
    check("playground over-allowance: delta is +1", msg.includes("+1"));
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 7f. playground: 0 compiled iframes (e.g. wasm-disabled build) → passes */
  {
    const root = await makeProject({
      "src/index.html": "<!doctype html><html><body></body></html>",
    });
    const compiled =
      "<!doctype html><html><body><div id=app></div></body></html>";
    let ok = false;
    try {
      const r = await assertIframeInvariant({
        projectRoot: root,
        compiledHtml: compiled,
        allowance: 1,
      });
      ok = r.sourceCount === 0 && r.compiledCount === 0;
    } catch (e) {
      console.error("unexpected throw:", e.message);
    }
    check("playground: 0 compiled iframes passes (wasm-disabled edge case)", ok);
    await fs.rm(root, { recursive: true, force: true });
  }

  /* 8. countHtmlIframes: simple regex sanity */
  {
    check("countHtmlIframes: zero", countHtmlIframes("<html></html>") === 0);
    check(
      "countHtmlIframes: two",
      countHtmlIframes('<iframe></iframe><iframe src="x"></iframe>') === 2,
    );
    check(
      "countHtmlIframes: case-insensitive",
      countHtmlIframes("<IFRAME></IFRAME>") === 1,
    );
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(2);
});
