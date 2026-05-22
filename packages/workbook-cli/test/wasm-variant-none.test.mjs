#!/usr/bin/env node
// wb-bd9 — wasmVariant: "none" build smoke test.
//
// Covers:
//   - With wasmVariant: "none", the compiled .html omits wasm-b64,
//     bindgen-src, and runtime-bundle-src script tags.
//   - workbook-spec, wb-source-bundle ARE still emitted.
//   - The artifact is dramatically smaller (< 500 KB raw uncompressed).
//   - A bare HTML workbook with wasmVariant: "none" still builds.
//
// The compiled artifact is gzip-wrapped at the inline-plugin tail; we
// peel that wrapper so we can read the inner head tags directly,
// instead of trying to grep the base64 envelope.

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { runBuild } from "../src/commands/build.mjs";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++;
  else fail++;
}

async function makeProject(extraConfig = "") {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-none-"));
  const root = await fs.realpath(tmp);
  await fs.writeFile(
    path.join(root, "workbook.config.mjs"),
    `export default {
       slug: "none-smoke",
       entry: "index.html",
       wasmVariant: "none",
       ${extraConfig}
     };\n`,
  );
  await fs.writeFile(
    path.join(root, "index.html"),
    `<!doctype html><html><head><title>none</title></head>` +
    `<body><div id="app">hello</div>` +
    `<script type="module">document.getElementById("app").textContent = "ready";</script>` +
    `</body></html>`,
  );
  return root;
}

async function makeProjectDefault() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-def-"));
  const root = await fs.realpath(tmp);
  await fs.writeFile(
    path.join(root, "workbook.config.mjs"),
    `export default {
       slug: "default-smoke",
       entry: "index.html",
     };\n`,
  );
  await fs.writeFile(
    path.join(root, "index.html"),
    `<!doctype html><html><head><title>def</title></head>` +
    `<body><div id="app">hello</div></body></html>`,
  );
  return root;
}

/** Peel the gzip-wrapper inserted by compress.mjs so we can grep the
 *  full head of the artifact. The wrapper embeds the gzipped HTML as a
 *  base64 <script id="wb-payload"> and decodes at runtime. */
function unwrapCompressed(html) {
  const match = html.match(
    /<script id="__wb_payload"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) return html;
  const raw = match[1].trim();
  try {
    const bytes = Buffer.from(raw, "base64");
    const decoded = gunzipSync(bytes).toString("utf8");
    return decoded;
  } catch {
    return html;
  }
}

async function main() {
  /* 1. wasmVariant: "none" — main smoke */
  const noneRoot = await makeProject();
  await runBuild({ project: noneRoot });
  const noneArtifact = path.join(noneRoot, "dist", "none-smoke.html");
  const noneRaw = await fs.readFile(noneArtifact, "utf8");
  const noneBytes = Buffer.byteLength(noneRaw);
  const noneUnwrapped = unwrapCompressed(noneRaw);

  check(
    "none: artifact exists",
    (await fs.stat(noneArtifact)).size > 0,
  );
  check(
    'none: no <script id="wasm-b64">',
    !/<script[^>]*id="wasm-b64"/.test(noneUnwrapped),
  );
  check(
    'none: no <script id="bindgen-src">',
    !/<script[^>]*id="bindgen-src"/.test(noneUnwrapped),
  );
  check(
    'none: no <script id="runtime-bundle-src">',
    !/<script[^>]*id="runtime-bundle-src"/.test(noneUnwrapped),
  );
  check(
    'none: workbook-spec IS emitted',
    /<script[^>]*id="workbook-spec"/.test(noneUnwrapped),
  );
  // wb-source-bundle is embedded into the compressed outer shell AFTER
  // brotliWrapHtml, so it lives in the raw artifact (not the unwrapped
  // inner HTML). Check both — either is fine.
  check(
    'none: wb-source-bundle IS emitted',
    /id="wb-source-bundle"/.test(noneRaw) || /id="wb-source-bundle"/.test(noneUnwrapped),
  );
  check(
    `none: artifact < 500 KB raw (got ${(noneBytes / 1024).toFixed(1)} KB)`,
    noneBytes < 500 * 1024,
    { noneBytes },
  );

  /* 2. negative: bare HTML workbook builds */
  const bareTmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-none-bare-"));
  const bareRoot = await fs.realpath(bareTmp);
  await fs.writeFile(
    path.join(bareRoot, "workbook.config.mjs"),
    `export default {
       slug: "bare",
       entry: "index.html",
       wasmVariant: "none",
     };\n`,
  );
  await fs.writeFile(
    path.join(bareRoot, "index.html"),
    `<!doctype html><html><head></head><body>bare</body></html>`,
  );
  let bareOk = false;
  try {
    await runBuild({ project: bareRoot });
    const bareArtifact = path.join(bareRoot, "dist", "bare.html");
    bareOk = (await fs.stat(bareArtifact)).size > 0;
  } catch (e) {
    console.error("bare build threw:", e.message);
  }
  check("bare workbook with wasmVariant: 'none' builds", bareOk);

  /* 3. cleanup */
  await fs.rm(noneRoot, { recursive: true, force: true });
  await fs.rm(bareRoot, { recursive: true, force: true });

  console.log("\n──────────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(2);
});
