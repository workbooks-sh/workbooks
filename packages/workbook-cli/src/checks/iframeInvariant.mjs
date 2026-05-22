// Build-time enforcement of the one-workbook-one-iframe invariant.
//
// The security model: a compiled workbook IS one iframe at the host's
// trust boundary. WASM runs inside that iframe. Internal components are
// just code in the bundle — never nested iframes. The build pipeline
// must not inject `<iframe>` tags. Author-written iframes pass through
// untouched (the author chose to embed something at their own risk;
// the host's sandbox attributes still apply).
//
// Enforcement is a count heuristic: count literal `<iframe` occurrences
// in the source tree vs the compiled HTML. If compiled > source, the
// pipeline injected one and we fail the build. Heuristic, not parser-
// based, because parsing every `.svelte`/`.tsx` dialect is out of scope
// — and the contract we're guarding ("the pipeline never emits an
// iframe") is binary, so a coarse counter suffices.

import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([
  "html", "htm", "svelte", "svx",
  "js", "mjs", "cjs", "jsx",
  "ts", "tsx",
  "md", "mdx",
  "vue", "astro",
]);

const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", ".cache", ".parcel-cache",
  ".vite", ".svelte-kit", ".turbo", "target", "pkg",
]);

// Files that live in the project but never end up in the compiled
// artifact. workbook.config.{js,mjs} is the canonical example — it's
// build-time configuration. Counting it would inflate the source side
// of the heuristic and mask a real injection.
const SKIP_FILES = new Set([
  "workbook.config.mjs",
  "workbook.config.js",
  "vite.config.mjs",
  "vite.config.js",
  "vite.config.ts",
]);

const IFRAME_RE = /<iframe\b/gi;

export async function countSourceIframes(projectRoot) {
  let total = 0;
  const occurrences = [];
  for await (const file of walk(projectRoot)) {
    let text;
    try {
      text = await fs.readFile(file.abs, "utf8");
    } catch {
      continue;
    }
    const matches = text.match(IFRAME_RE);
    if (matches && matches.length > 0) {
      total += matches.length;
      occurrences.push({ rel: file.rel, count: matches.length });
    }
  }
  return { total, occurrences };
}

export function countHtmlIframes(html) {
  const matches = html.match(IFRAME_RE);
  return matches ? matches.length : 0;
}

/**
 * Throws if compiled > source + allowance. The delta is the number
 * of iframes the build pipeline appears to have injected. Author-
 * written iframes in template literals (e.g. `\`<iframe src=…>\``)
 * still register in the source count because the regex is
 * substring-based.
 *
 * `allowance` is the number of legitimate runtime-emitted iframes the
 * caller knows about — currently used only for playground builds,
 * where the runtime's Playground.svelte emits exactly one canvas
 * iframe that lives in node_modules (excluded from the source walk).
 */
export async function assertIframeInvariant({ projectRoot, compiledHtml, allowance = 0 }) {
  const compiled = countHtmlIframes(compiledHtml);
  if (compiled === 0) return { sourceCount: 0, compiledCount: 0, delta: 0, allowance };

  const { total: sourceCount, occurrences } = await countSourceIframes(projectRoot);
  const delta = compiled - sourceCount - allowance;
  if (delta <= 0) return { sourceCount, compiledCount: compiled, delta, allowance };

  const sourceList = occurrences.length
    ? occurrences.map((o) => `    ${o.rel} (${o.count})`).join("\n")
    : "    (none)";
  const allowanceNote = allowance > 0
    ? `\n  (playground type already accounts for ${allowance} runtime-emitted iframe; ` +
      `anything beyond that is still a violation.)`
    : "";
  throw new Error(
    `workbook build: iframe invariant violated.\n` +
    `  compiled HTML contains ${compiled} <iframe occurrence(s); ` +
    `source tree has ${sourceCount}.\n` +
    `  delta of +${delta} means the build pipeline injected a nested iframe.\n` +
    `  This breaks the one-workbook-one-iframe trust boundary.${allowanceNote}\n` +
    `  See: packages/runtime/README.md > "One workbook, one iframe".\n` +
    `  Source iframe sites:\n${sourceList}`,
  );
}

async function* walk(root, relPrefix = "") {
  const absDir = relPrefix ? path.join(root, relPrefix) : root;
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    if (ent.name.startsWith(".") && ent.name !== ".gitignore") continue;
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      yield* walk(root, rel);
    } else if (ent.isFile()) {
      if (SKIP_FILES.has(ent.name)) continue;
      const ext = path.extname(ent.name).slice(1).toLowerCase();
      if (SOURCE_EXTENSIONS.has(ext)) {
        yield { abs: path.join(root, rel), rel };
      }
    }
  }
}
