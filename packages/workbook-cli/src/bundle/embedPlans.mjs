// wb-4vhr.16 PART 2 — embed `.org` plan files into the compiled `.html`
// as discrete `<script type="text/worg">` blocks.
//
// Element shape (one per `.org` file under src/):
//
//   <script id="workbook-plan-<slug>"
//           type="text/worg"
//           data-format="raw+gzip+base64"
//           data-source-path="src/plan.org"
//           data-uncompressed-size="142">BASE64...</script>
//
// The payload is the raw `.org` source, gzipped + base64'd. The runtime
// panel (wb-4vhr.17) can decode + hand to worg WASM for parsing.
//
// Why store raw source instead of a pre-parsed AST: worg-wasm doesn't
// expose a full-AST export today (only `parse_headlines`). Raw source
// lets the panel do whatever shape it needs without an early format
// commitment. The source bundle already carries the same bytes; this
// duplicate is cheap to extract (no manifest walk) — the panel
// shouldn't have to gunzip a 50 MB bundle just to find a plan.
//
// Invariant: zero `.org` files → zero output. The compiled artifact is
// byte-identical to today's build.

import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const PLAN_MARKER_OPEN = '<script id="workbook-plan-';

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".vscode",
  ".idea",
]);

/**
 * Walk `root` and return every `.org` file as
 *   [{ relPath: "src/plan.org", source: Buffer }, ...]
 * sorted by relPath for reproducible output.
 *
 * Skips the same directories as the source-bundle walker so embedded
 * dependencies (node_modules, .git) don't accidentally show up.
 */
export async function collectOrgFiles(root) {
  const out = [];
  await walk(root, "");
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return out;

  async function walk(absDir, relDir) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
        await walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile() && entry.name.endsWith(".org")) {
        const source = await fs.readFile(path.join(absDir, entry.name));
        out.push({ relPath: rel, source });
      }
    }
  }
}

/**
 * Build the `<script type="text/worg">` block for one .org file.
 * Exported for tests.
 */
export function buildPlanScript(relPath, source) {
  const slug = slugFromPath(relPath);
  const gz = gzipSync(source);
  const b64 = gz.toString("base64");
  const attrs = [
    `id="workbook-plan-${slug}"`,
    'type="text/worg"',
    'data-format="raw+gzip+base64"',
    `data-source-path="${escapeAttr(relPath)}"`,
    `data-uncompressed-size="${source.length}"`,
  ];
  return `<script ${attrs.join(" ")}>${b64}</script>`;
}

/**
 * Embed one block per `.org` file into `html`. Idempotent: any existing
 * blocks emitted by a prior call are stripped first. When `orgFiles` is
 * empty, returns `html` unchanged (byte-identical guarantee).
 */
export function embedPlans(html, orgFiles) {
  const stripped = stripPlans(html);
  if (orgFiles.length === 0) return stripped === html ? html : stripped;

  const blocks = orgFiles
    .map(({ relPath, source }) => buildPlanScript(relPath, source))
    .join("");

  // Insert just before </body> so the blocks sit alongside the source
  // bundle. Same fallback chain as embedSource.mjs.
  if (stripped.includes("</body>")) {
    return stripped.replace("</body>", `${blocks}</body>`);
  }
  if (stripped.includes("</html>")) {
    return stripped.replace("</html>", `${blocks}</html>`);
  }
  return stripped + blocks;
}

/**
 * Pull every embedded plan back out. Returns an array of
 *   { id, sourcePath, uncompressedSize, source: Buffer }
 * matching what `embedPlans` wrote. Returns [] for an artifact with
 * no plans (byte-identical builds round-trip to nothing).
 */
export function extractPlans(html) {
  const out = [];
  const re =
    /<script id="workbook-plan-([^"]+)"\s+type="text\/worg"\s+data-format="raw\+gzip\+base64"\s+data-source-path="([^"]*)"\s+data-uncompressed-size="(\d+)">([^<]+)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, id, sourcePath, size, b64] = m;
    out.push({
      id,
      sourcePath: unescapeAttr(sourcePath),
      uncompressedSize: Number(size),
      source: Buffer.from(b64, "base64"),
    });
  }
  return out;
}

// Strip any pre-existing plan blocks (idempotent embed). The marker
// matches both fresh and rewritten artifacts.
function stripPlans(html) {
  let out = html;
  let idx = out.indexOf(PLAN_MARKER_OPEN);
  while (idx !== -1) {
    const close = out.indexOf("</script>", idx);
    if (close === -1) break;
    out = out.slice(0, idx) + out.slice(close + "</script>".length);
    idx = out.indexOf(PLAN_MARKER_OPEN);
  }
  return out;
}

// Stable, collision-free per-file slug: lowercase relative path with
// non-word chars → "-", `.org` extension dropped. So
// `src/plans/foo.org` → `src-plans-foo`.
function slugFromPath(relPath) {
  return relPath
    .replace(/\.org$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function unescapeAttr(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
