#!/usr/bin/env node
// wb-div.2 — `workbook status` round-trip tests.
//
// Builds a fixture project's source bundle by hand (skipping a real
// `workbook build` — that'd pull in Vite + WASM and slow the suite
// 100x), embeds it into a dist/<slug>.html, then runs the CLI in a
// child process so we can assert on exit code AND stdout.
//
// Covers:
//   - clean tree         → exit 0, "in sync"
//   - modify a file      → exit 1, listed as M
//   - add a file         → exit 1, listed as A
//   - remove a file      → exit 1, listed as D
//   - missing dist html  → exit 2
//   - --json output      → parses, drift flag matches exit code
//   - --no-bundle case   → exit 2 (artifact has no bundle)

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSourceBundle } from "../src/bundle/sourceBundle.mjs";
import { embedBundle } from "../src/bundle/embedSource.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "bin", "workbook.mjs");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++;
  else fail++;
}

function run(args, cwd) {
  return spawnSync("node", [CLI, "status", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-status-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.writeFile(
    path.join(root, "workbook.config.mjs"),
    'export default { slug: "smoke", entry: "src/index.html", inlineRuntime: false };\n',
  );
  await fs.writeFile(path.join(root, "src", "index.html"), "<!doctype html><html><body>hi</body></html>");
  await fs.writeFile(path.join(root, "src", "main.js"), "console.log('hi');\n");
  await fs.writeFile(path.join(root, "src", "styles.css"), ".x{color:red}\n");
  return root;
}

async function writeArtifact(root, { skipBundle = false } = {}) {
  const html = "<!doctype html><html><body><h1>art</h1></body></html>";
  const artifactPath = path.join(root, "dist", "smoke.html");
  if (skipBundle) {
    await fs.writeFile(artifactPath, html);
    return artifactPath;
  }
  const { buffer, fileCount, uncompressedSize } = await createSourceBundle(root, {
    rootName: "smoke",
  });
  const wrapped = embedBundle(html, buffer, {
    rootName: "smoke",
    fileCount,
    bundleSize: buffer.length,
    uncompressedSize,
  });
  await fs.writeFile(artifactPath, wrapped);
  return artifactPath;
}

async function main() {
  /* 1. clean tree → exit 0, in sync */
  {
    const root = await makeFixture();
    await writeArtifact(root);
    const r = run([], root);
    check("clean tree: exit 0", r.status === 0, { status: r.status, stderr: r.stderr });
    check("clean tree: stdout contains 'in sync'", /in sync/.test(r.stdout));
  }

  /* 2. modified file → exit 1, M src/main.js */
  {
    const root = await makeFixture();
    await writeArtifact(root);
    await fs.writeFile(path.join(root, "src", "main.js"), "console.log('changed');\n");
    const r = run([], root);
    check("modified: exit 1", r.status === 1, { status: r.status });
    check("modified: lists src/main.js", /src\/main\.js/.test(r.stdout));
    check("modified: shows 'modified locally'", /modified locally/.test(r.stdout));
  }

  /* 3. added file → exit 1, A src/new.js */
  {
    const root = await makeFixture();
    await writeArtifact(root);
    await fs.writeFile(path.join(root, "src", "new.js"), "// new\n");
    const r = run([], root);
    check("added: exit 1", r.status === 1, { status: r.status });
    check("added: lists src/new.js", /src\/new\.js/.test(r.stdout));
    check("added: shows 'added locally'", /added locally/.test(r.stdout));
  }

  /* 4. removed file → exit 1, D src/styles.css */
  {
    const root = await makeFixture();
    await writeArtifact(root);
    await fs.rm(path.join(root, "src", "styles.css"));
    const r = run([], root);
    check("removed: exit 1", r.status === 1, { status: r.status });
    check("removed: lists src/styles.css", /src\/styles\.css/.test(r.stdout));
    check("removed: shows 'removed locally'", /removed locally/.test(r.stdout));
  }

  /* 5. missing dist artifact → exit 2 */
  {
    const root = await makeFixture();
    // No writeArtifact call.
    const r = run([], root);
    check("missing artifact: exit 2", r.status === 2, { status: r.status, stderr: r.stderr });
    check("missing artifact: stderr mentions workbook build", /workbook build/.test(r.stderr));
  }

  /* 6. --json output structure */
  {
    const root = await makeFixture();
    await writeArtifact(root);
    await fs.writeFile(path.join(root, "src", "main.js"), "// drift\n");
    const r = run(["--json"], root);
    check("json: exit 1 on drift", r.status === 1);
    let parsed;
    try { parsed = JSON.parse(r.stdout); } catch {}
    check("json: parses", !!parsed);
    check("json: inSync=false", parsed && parsed.inSync === false);
    check("json: counts.modified === 1", parsed && parsed.counts?.modified === 1);
    check("json: modified contains src/main.js", parsed && parsed.modified?.includes("src/main.js"));
  }

  /* 7. --no-bundle artifact → exit 2 */
  {
    const root = await makeFixture();
    await writeArtifact(root, { skipBundle: true });
    const r = run([], root);
    check("no-bundle: exit 2", r.status === 2, { status: r.status });
    check("no-bundle: error mentions bundle", /bundle/i.test(r.stderr));
  }

  /* 8. --help shows usage */
  {
    const r = run(["--help"], os.tmpdir());
    check("help: exit 0", r.status === 0);
    check("help: mentions Usage", /Usage:/.test(r.stdout));
  }

  console.log(`\n# ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
