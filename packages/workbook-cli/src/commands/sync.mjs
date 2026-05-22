// `workbook pull` / `workbook push` — explicit sync between the
// local source tree and the studio-published artifact. Always shows
// a diff first; user confirms; applies. Never silent overwrite.
//
// Pull flow:
//   1. Authenticate with broker (cached bearer or loopback OAuth).
//   2. GET /v1/workbooks/<id>/artifact → HTML bytes.
//   3. Extract the embedded source bundle.
//   4. Compute diff vs the local working tree.
//   5. Print the diff. Prompt (unless --force).
//   6. Write changed files. Optionally delete locally-only files
//      (--delete-extra).
//
// Push flow:
//   1. `workbook build` to produce the current artifact.
//   2. Fetch the currently-published artifact (best-effort; 404 = new).
//   3. Diff the local-built bundle vs the remote bundle.
//   4. Print the diff. Prompt (unless --force).
//   5. PUT the new artifact via the same publish surface.
//
// wb-div.3.

import path from "node:path";
import fs from "node:fs/promises";
import readline from "node:readline";
import { loadConfig } from "../util/config.mjs";
import {
  ensureBearer,
  DEFAULT_BROKER,
  putBytes,
} from "../util/brokerClient.mjs";
import {
  decodeBundle,
  extractBundle,
  readBundleMeta,
} from "../bundle/embedSource.mjs";
import { runBuild } from "./build.mjs";

export async function runPull(opts = {}) {
  const project = opts.project ?? ".";
  const config = await loadConfig(project);
  const workbookId = opts.id;
  if (!workbookId) {
    throw new Error(
      "workbook pull: --id <workbookId> is required.\n" +
        "  Find it via `workbook publish` output, or in studio at the workbook detail page.",
    );
  }

  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  // `?full=1` opts into the unstripped artifact — the broker defaults
  // its GET to the "view" variant (source bundle stripped) for hosted
  // recipients, but sync needs the embedded bundle to diff against the
  // local tree.
  const url = `${DEFAULT_BROKER}/v1/workbooks/${encodeURIComponent(workbookId)}/artifact?full=1`;
  process.stdout.write(`[workbook pull] fetching ${url}…\n`);
  const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
  if (res.status === 404) {
    throw new Error(
      `workbook pull: no published artifact for id ${workbookId}. Did you mean a different id?`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `workbook pull: GET artifact failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }
  const html = await res.text();

  const remote = await extractRemoteBundle(html, workbookId);
  const local = await readLocalTree(config.root);

  const diff = diffTrees({ remote: remote.files, local });
  printDiff("pull", diff);
  if (diff.added.length + diff.modified.length + diff.removed.length === 0) {
    process.stdout.write("[workbook pull] already in sync — nothing to do.\n");
    return;
  }

  if (!opts.force) {
    const ok = await prompt(
      `apply ${diff.added.length} add, ${diff.modified.length} modify, ` +
        `${opts["delete-extra"] ? diff.removed.length : 0} remove? [y/N] `,
    );
    if (!ok) {
      process.stdout.write("[workbook pull] aborted.\n");
      return;
    }
  }

  for (const f of [...diff.added, ...diff.modified]) {
    const dest = path.join(config.root, f.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, f.remoteContent);
  }
  if (opts["delete-extra"]) {
    for (const f of diff.removed) {
      try {
        await fs.unlink(path.join(config.root, f.path));
      } catch {
        /* gone already, fine */
      }
    }
  }
  process.stdout.write(
    `[workbook pull] applied ${diff.added.length + diff.modified.length} change(s)` +
      `${opts["delete-extra"] ? ` (+ ${diff.removed.length} deletions)` : ""}.\n`,
  );
}

export async function runPush(opts = {}) {
  const project = opts.project ?? ".";
  const config = await loadConfig(project);
  const workbookId = opts.id;
  if (!workbookId) {
    throw new Error(
      "workbook push: --id <workbookId> is required.\n" +
        "  For first-time uploads, use `workbook publish` instead.",
    );
  }

  // Build locally first — push always uploads the just-built artifact.
  process.stdout.write("[workbook push] building locally…\n");
  await runBuild({ project });

  const outDir = path.resolve(config.root, opts.out ?? "dist");
  const artifactPath = path.join(outDir, `${config.slug}.html`);
  let localHtml;
  try {
    localHtml = await fs.readFile(artifactPath, "utf8");
  } catch {
    // Fallback to plain index.html for --no-wasm builds.
    localHtml = await fs.readFile(path.join(outDir, "index.html"), "utf8");
  }

  // Best-effort fetch the currently-published artifact for the diff.
  // `?full=1` — see runPull for why.
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const remoteUrl = `${DEFAULT_BROKER}/v1/workbooks/${encodeURIComponent(workbookId)}/artifact?full=1`;
  const remoteRes = await fetch(remoteUrl, {
    headers: { authorization: `Bearer ${bearer}` },
  });

  let diff;
  if (remoteRes.status === 404) {
    process.stdout.write(
      "[workbook push] no existing artifact at remote — treating as initial upload.\n",
    );
    const localBundle = await extractRemoteBundle(localHtml, "<local>");
    diff = {
      added: localBundle.files,
      modified: [],
      removed: [],
    };
  } else if (!remoteRes.ok) {
    const body = await remoteRes.text().catch(() => "");
    throw new Error(
      `workbook push: GET artifact failed (${remoteRes.status}): ${body.slice(0, 500)}`,
    );
  } else {
    const remoteHtml = await remoteRes.text();
    const remote = await extractRemoteBundle(remoteHtml, workbookId);
    const localBundle = await extractRemoteBundle(localHtml, "<local>");
    const localMap = new Map(localBundle.files.map((f) => [f.path, f]));
    const remoteMap = new Map(remote.files.map((f) => [f.path, f]));
    diff = diffBundleMaps({ from: remoteMap, to: localMap });
  }

  printDiff("push", diff);
  if (diff.added.length + diff.modified.length + diff.removed.length === 0) {
    process.stdout.write("[workbook push] remote already matches local — nothing to upload.\n");
    return;
  }

  if (!opts.force) {
    const ok = await prompt(
      `upload local artifact to ${workbookId}? [y/N] `,
    );
    if (!ok) {
      process.stdout.write("[workbook push] aborted.\n");
      return;
    }
  }

  await putBytes(
    `/v1/workbooks/${encodeURIComponent(workbookId)}/artifact`,
    localHtml,
    { bearer, broker: DEFAULT_BROKER },
  );
  process.stdout.write(`[workbook push] uploaded → ${workbookId}\n`);
}

// ── helpers ─────────────────────────────────────────────────────

async function extractRemoteBundle(html, label) {
  const meta = readBundleMeta(html);
  if (!meta) {
    throw new Error(
      `workbook sync: artifact ${label} has no embedded source bundle. ` +
        `Was it built with --no-bundle?`,
    );
  }
  if (meta.version !== "1") {
    throw new Error(
      `workbook sync: bundle version "${meta.version}" not supported (expected 1).`,
    );
  }
  const buf = extractBundle(html);
  const manifest = decodeBundle(buf);
  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error(`workbook sync: malformed bundle manifest in ${label}.`);
  }
  // Drop entries that were truncated at build time (no content to diff).
  const files = manifest.files
    .filter((f) => f && !f.truncated && f.content != null && typeof f.path === "string")
    .map((f) => ({
      path: sanitizePath(f.path),
      remoteContent: Buffer.from(f.content, "base64"),
    }))
    .filter((f) => f.path != null);
  return { files };
}

async function readLocalTree(rootDir) {
  // Mirrors the bundler's heuristic: include source files only, skip
  // node_modules / dist / .git / hidden dotfiles at the top. The
  // diff is approximate — we don't honor every .gitignore subtlety,
  // but the common cases land correctly. Authors with niche layouts
  // can pass --root to scope.
  const SKIP = new Set([
    "node_modules", "dist", ".git", ".svelte-kit", ".vite", ".turbo",
    ".cache", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "package-lock.json",
  ]);
  const result = new Map();
  async function walk(dir, rel) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, relPath);
      } else if (e.isFile()) {
        result.set(relPath, await fs.readFile(abs));
      }
    }
  }
  try {
    await walk(rootDir, "");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return result;
}

function diffTrees({ remote, local }) {
  const added = [];
  const modified = [];
  const removed = [];
  const remotePaths = new Set(remote.map((f) => f.path));
  for (const f of remote) {
    const localBuf = local.get(f.path);
    if (!localBuf) {
      added.push(f);
    } else if (!localBuf.equals(f.remoteContent)) {
      modified.push(f);
    }
  }
  for (const [relPath, _buf] of local) {
    if (!remotePaths.has(relPath)) {
      removed.push({ path: relPath });
    }
  }
  return { added, modified, removed };
}

function diffBundleMaps({ from, to }) {
  // 'from' is the baseline; 'to' is the new state. Added = in 'to'
  // but not 'from'. Removed = in 'from' but not 'to'. Modified =
  // both, different bytes.
  const added = [];
  const modified = [];
  const removed = [];
  for (const [p, f] of to) {
    const baseline = from.get(p);
    if (!baseline) {
      added.push(f);
    } else if (!baseline.remoteContent.equals(f.remoteContent)) {
      modified.push(f);
    }
  }
  for (const [p, f] of from) {
    if (!to.has(p)) removed.push(f);
  }
  return { added, modified, removed };
}

function printDiff(verb, diff) {
  const total = diff.added.length + diff.modified.length + diff.removed.length;
  process.stdout.write(`[workbook ${verb}] diff (${total} change${total === 1 ? "" : "s"}):\n`);
  for (const f of diff.added) {
    process.stdout.write(`  + ${f.path}\n`);
  }
  for (const f of diff.modified) {
    process.stdout.write(`  ~ ${f.path}\n`);
  }
  for (const f of diff.removed) {
    process.stdout.write(`  - ${f.path}\n`);
  }
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function sanitizePath(p) {
  if (typeof p !== "string" || p.length === 0) return null;
  if (p.includes("\0")) return null;
  const norm = p.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:[\\/]/.test(norm)) return null;
  if (norm.split("/").some((s) => s === "..")) return null;
  return norm;
}
