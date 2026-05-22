// `workbook status [project]` — diff the local working tree against
// the source bundle embedded in the most recently built artifact at
// `dist/<slug>.html`. Pure offline operation: the artifact IS the
// baseline. Comparing against the studio-published state is the job
// of wb-div.3 (`workbook pull/push`).
//
// Exit codes:
//   0 — local source tree matches the bundle exactly
//   1 — drift (modified / added / removed)
//   2 — error (missing dist artifact, no embedded bundle, malformed)
//
// Output:
//   default — human-readable grouped sections + counts at the end
//   --json  — { inSync, modified, added, removed, counts, artifact }
//
// The bundle's per-file `mode` and `truncated` flags are ignored —
// they're build artifacts, not user content. The manifest's `rootName`
// and `createdAt` are metadata; also ignored.

import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadConfig } from "../util/config.mjs";
import { createSourceBundle } from "../bundle/sourceBundle.mjs";
import {
  extractBundle,
  decodeBundle,
  readBundleMeta,
} from "../bundle/embedSource.mjs";

const HELP = [
  "workbook status [project] — diff local source tree against last built .html",
  "",
  "Compares files under the project root against the source bundle embedded",
  "in dist/<slug>.html (the most recent local build). Fully offline.",
  "",
  "Usage:",
  "  workbook status [project]",
  "  workbook status --json",
  "  workbook status --help",
  "",
  "Options:",
  "  --json     emit structured JSON (CI/automation)",
  "  --out <d>  override dist directory (default: dist)",
  "  --help     show this message",
  "",
  "Exit codes:",
  "  0  in sync",
  "  1  drift detected (modified / added / removed)",
  "  2  error — no dist artifact, no embedded bundle, malformed bundle",
  "",
].join("\n");

export async function runStatus(opts = {}) {
  if (opts.help === true) {
    process.stdout.write(HELP);
    return;
  }

  const project = opts.project ?? opts._?.[0] ?? ".";
  const useJson = opts.json === true;

  let config;
  try {
    config = await loadConfig(project);
  } catch (err) {
    return failHard(useJson, err.message, 2);
  }

  const outDir = path.resolve(config.root, opts.out ?? "dist");
  const artifactPath = await resolveArtifact(outDir, config.slug);
  if (!artifactPath) {
    return failHard(
      useJson,
      `workbook status: no built artifact at ${path.join(path.relative(process.cwd(), outDir) || ".", config.slug)}.html.\n` +
        `Run \`workbook build\` first.`,
      2,
    );
  }

  let html;
  try {
    html = await fs.readFile(artifactPath, "utf8");
  } catch (err) {
    return failHard(useJson, `workbook status: cannot read ${artifactPath}: ${err.message}`, 2);
  }

  const meta = readBundleMeta(html);
  if (!meta) {
    return failHard(
      useJson,
      `workbook status: ${path.relative(process.cwd(), artifactPath)} has no embedded source bundle.\n` +
        `Rebuild without --no-bundle (and without --encrypt) so the local source can be compared.`,
      2,
    );
  }
  let manifest;
  try {
    const buf = extractBundle(html);
    manifest = decodeBundle(buf);
  } catch (err) {
    return failHard(useJson, `workbook status: malformed source bundle: ${err.message}`, 2);
  }
  if (!manifest || !Array.isArray(manifest.files)) {
    return failHard(useJson, `workbook status: malformed source bundle (no files array)`, 2);
  }

  // Build the in-bundle hash map. Files marked `truncated` were too
  // large to embed (>5 MiB by default) — compare their original size
  // against the local file's size instead. Not a content compare, but
  // the only honest signal available.
  const bundleByPath = new Map();
  for (const f of manifest.files) {
    if (typeof f?.path !== "string") continue;
    if (f.truncated || f.content == null) {
      bundleByPath.set(f.path, { truncated: true, size: f.originalSize ?? 0 });
      continue;
    }
    const buf = Buffer.from(f.content, "base64");
    bundleByPath.set(f.path, { hash: sha256(buf), size: buf.length });
  }

  // Walk the local tree using the same producer the build uses, so
  // ignores stay aligned (node_modules/, dist/, .git/, .env, …).
  // We rebuild a bundle in-memory and pull hashes out of its file
  // entries. This re-reads each file once — same cost as walking
  // directly, and guarantees ignore-rule parity.
  const includeGit = config.bundle?.includeGit === true;
  const additionalIgnore = config.bundle?.additionalIgnore ?? [];
  let local;
  try {
    local = await createSourceBundle(config.root, {
      includeGit,
      additionalIgnore,
      rootName: config.slug,
    });
  } catch (err) {
    return failHard(useJson, `workbook status: ${err.message}`, 2);
  }
  // Decode the local manifest we just produced so we share the
  // same Buffer→hash code path with the bundle side.
  const localManifest = decodeBundle(local.buffer);
  const localByPath = new Map();
  for (const f of localManifest.files) {
    if (f.truncated || f.content == null) {
      localByPath.set(f.path, { truncated: true, size: f.originalSize ?? 0 });
      continue;
    }
    const buf = Buffer.from(f.content, "base64");
    localByPath.set(f.path, { hash: sha256(buf), size: buf.length });
  }

  const modified = [];
  const added = [];
  const removed = [];
  const inSync = [];

  // Stable sort across both maps' keys for deterministic output.
  const allPaths = new Set([...bundleByPath.keys(), ...localByPath.keys()]);
  for (const p of [...allPaths].sort()) {
    const b = bundleByPath.get(p);
    const l = localByPath.get(p);
    if (b && !l) { removed.push(p); continue; }
    if (!b && l) { added.push(p); continue; }
    // Both present.
    if (b.truncated || l.truncated) {
      // Best-effort size compare. Equal size === call it sync;
      // different size === modified.
      if (b.size === l.size) inSync.push(p);
      else modified.push(p);
      continue;
    }
    if (b.hash === l.hash) inSync.push(p);
    else modified.push(p);
  }

  const drift = modified.length + added.length + removed.length;
  const result = {
    inSync: drift === 0,
    artifact: path.relative(process.cwd(), artifactPath),
    modified,
    added,
    removed,
    counts: {
      inSync: inSync.length,
      modified: modified.length,
      added: added.length,
      removed: removed.length,
    },
  };

  if (useJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(drift === 0 ? 0 : 1);
  }

  renderHuman(result);
  process.exit(drift === 0 ? 0 : 1);
}

function renderHuman(r) {
  const c = colorize(process.stdout.isTTY === true);
  const lines = [];
  lines.push(`${c.dim("artifact:")} ${r.artifact}`);
  lines.push("");

  if (r.inSync) {
    lines.push(c.green("in sync — local tree matches the bundle"));
    lines.push("");
    lines.push(summaryLine(r.counts, c));
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  if (r.modified.length > 0) {
    lines.push(c.amber(`modified locally (${r.modified.length})`));
    for (const p of r.modified) lines.push(`  ${c.amber("M")} ${p}`);
    lines.push("");
  }
  if (r.added.length > 0) {
    lines.push(c.green(`added locally (${r.added.length})`));
    for (const p of r.added) lines.push(`  ${c.green("A")} ${p}`);
    lines.push("");
  }
  if (r.removed.length > 0) {
    lines.push(c.rose(`removed locally (${r.removed.length})`));
    for (const p of r.removed) lines.push(`  ${c.rose("D")} ${p}`);
    lines.push("");
  }
  lines.push(summaryLine(r.counts, c));
  process.stdout.write(lines.join("\n") + "\n");
}

function summaryLine(counts, c) {
  const parts = [
    `${counts.inSync} in sync`,
    `${counts.modified} modified`,
    `${counts.added} added`,
    `${counts.removed} removed`,
  ];
  return c.dim(parts.join(", "));
}

function colorize(isTty) {
  if (!isTty) {
    return { dim: s => s, green: s => s, amber: s => s, rose: s => s };
  }
  const wrap = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
  return {
    dim: wrap("2"),
    green: wrap("32"),
    amber: wrap("33"),
    rose: wrap("31"),
  };
}

async function resolveArtifact(outDir, slug) {
  const slugPath = path.join(outDir, `${slug}.html`);
  try {
    await fs.access(slugPath);
    return slugPath;
  } catch {}
  // Fall back to dist/index.html — what --no-wasm / inlineRuntime:false
  // emits. Same precedence as build's resolveArtifactPath.
  const indexPath = path.join(outDir, "index.html");
  try {
    await fs.access(indexPath);
    return indexPath;
  } catch {}
  return null;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function failHard(useJson, message, code) {
  if (useJson) {
    process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
  } else {
    process.stderr.write(message.endsWith("\n") ? message : message + "\n");
  }
  process.exit(code);
}
