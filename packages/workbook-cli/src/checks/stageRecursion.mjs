// shape-drift-ok: this check reads both manifest.stage (canonical) AND
// manifest.playground (legacy back-compat) so wrap chains spanning old
// and new artifacts still resolve. The 'playground' string appears here
// intentionally — file rename + symbol cleanup are tracked separately.

// Build-time recursion guard for stage-bearing workbooks (canonical
// type:"spa" + stage block, or legacy type:"playground").
//
// A playground wraps another workbook in a sandboxed iframe. One layer
// of self-recursion (a playground wrapping a playground) is allowed —
// useful when tuning a playground's own UI inside another playground.
// Two or more layers is a hard error; deep nesting compounds iframe
// boundaries and capability dialogs with no upside.
//
// The check is build-time on the PLAYGROUND being built. Resolving
// each wrap target requires reading the compiled `.html` of the
// wrapped workbook off disk and parsing its embedded
// `<script id="workbook-spec">` to inspect manifest.type and
// manifest.playground.wraps.
//
// `resolveWraps(wraps, fromDir)` is a caller-supplied async function
// returning an absolute path to a built artifact, or null if the
// target can't be resolved locally (remote URL, missing build, etc).
// The default resolver tries `dist/<slug>.html`,
// `../<slug>/dist/<slug>.html`, and `wraps` treated as a real path.

import fs from "node:fs/promises";
import path from "node:path";

const MAX_STAGE_DEPTH = 1; // chain length beyond root before failing

const SPEC_RE =
  /<script\s+id=["']workbook-spec["'][^>]*>([\s\S]*?)<\/script>/i;

/**
 * Read manifest.type + manifest.playground.wraps from a built workbook.
 * Returns `{ type, wraps, slug }` or null if the file is missing /
 * unparseable. Failing soft here is intentional — the calling check
 * passes-with-warning on resolution failures so a fresh project that
 * hasn't built its wrap target yet doesn't break.
 */
export async function readWorkbookManifest(absPath) {
  let html;
  try {
    html = await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
  const m = html.match(SPEC_RE);
  if (!m) return null;
  let spec;
  try {
    spec = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const manifest = spec?.manifest;
  if (!manifest || typeof manifest !== "object") return null;
  const stageBlock = manifest.stage ?? manifest.playground;
  return {
    type: typeof manifest.type === "string" ? manifest.type : null,
    hasStage: !!(stageBlock && typeof stageBlock.wraps === "string"),
    wraps:
      stageBlock && typeof stageBlock.wraps === "string"
        ? stageBlock.wraps
        : null,
    slug: typeof manifest.slug === "string" ? manifest.slug : null,
  };
}

/**
 * Default resolver: try sibling `dist/` layouts, then treat `wraps`
 * as a real file path. Slug-only `wraps` ("my-workbook") resolves to
 * `<projectRoot>/dist/my-workbook.html` first, then
 * `<projectRoot>/../my-workbook/dist/my-workbook.html`. URL-like
 * values ("http://", "https://") return null — caller treats that
 * as a non-fatal skip.
 */
export async function defaultResolveWraps(wraps, fromDir) {
  if (!wraps) return null;
  if (/^[a-z]+:\/\//i.test(wraps)) return null;

  const candidates = [];
  if (path.isAbsolute(wraps) || wraps.includes("/") || wraps.endsWith(".html")) {
    candidates.push(path.resolve(fromDir, wraps));
  }
  if (/^[A-Za-z0-9_-]+$/.test(wraps)) {
    candidates.push(path.join(fromDir, "dist", `${wraps}.html`));
    candidates.push(path.join(fromDir, "..", wraps, "dist", `${wraps}.html`));
  }

  for (const c of candidates) {
    try {
      const stat = await fs.stat(c);
      if (stat.isFile()) return c;
    } catch {}
  }
  return null;
}

/**
 * Assert the stage's recursion depth is within MAX_STAGE_DEPTH.
 *
 *   config         — the loaded workbook.config for the workbook being built.
 *   resolveWraps   — async (wraps, fromDir) => absPath | null.
 *                    Defaults to `defaultResolveWraps`.
 *   warn           — optional sink for non-fatal notices (default: stderr).
 *
 * Walks the wrap chain reading each target's embedded workbook-spec.
 * Returns `{ depth, chain }` on success. Throws on a chain that exceeds
 * the limit. Missing / unresolvable targets short-circuit with a warning
 * — that's a separate build's responsibility to surface.
 */
export async function assertStageRecursion(
  config,
  resolveWraps = defaultResolveWraps,
  warn = (msg) => process.stderr.write(`[workbook] ${msg}\n`),
) {
  // The check fires for any workbook that mounts a stage primitive —
  // either canonical (type:"spa" + config.stage) or legacy
  // (type:"playground" + config.playground, surfaced via the validator
  // as config.stage). Plain shapes skip the check entirely.
  const stageBlock = config?.stage ?? config?.playground;
  if (!stageBlock) return { depth: 0, chain: [] };
  const rootSlug = config.slug ?? "<root>";
  const rootWraps = stageBlock.wraps;
  if (!rootWraps) return { depth: 0, chain: [rootSlug] };

  const chain = [rootSlug];
  let currentWraps = rootWraps;
  let currentDir = config.root ?? process.cwd();

  // Walk one extra step past MAX so the error message can name all
  // three slugs in the failing chain.
  for (let depth = 1; depth <= MAX_STAGE_DEPTH + 1; depth++) {
    const targetPath = await resolveWraps(currentWraps, currentDir);
    if (!targetPath) {
      warn(
        `stage: cannot resolve wraps target '${currentWraps}' locally; ` +
          `skipping recursion check at depth ${depth}. ` +
          `Build the wrapped workbook first or check the slug/path.`,
      );
      return { depth: depth - 1, chain };
    }
    const manifest = await readWorkbookManifest(targetPath);
    if (!manifest) {
      warn(
        `stage: target '${currentWraps}' at ${targetPath} has no readable ` +
          `workbook-spec; skipping recursion check at depth ${depth}.`,
      );
      return { depth: depth - 1, chain };
    }
    const targetSlug = manifest.slug ?? currentWraps;
    chain.push(targetSlug);

    if (!manifest.hasStage) {
      return { depth, chain };
    }
    if (depth > MAX_STAGE_DEPTH) {
      throw new Error(
        `stage: recursion limit exceeded (max depth ${MAX_STAGE_DEPTH}). ` +
          `Chain: ${chain.join(" → ")}. ` +
          `A stage may wrap one layer of stage; deeper nesting is disallowed.`,
      );
    }
    if (!manifest.wraps) {
      // Target is a stage but has no wraps target itself — pass.
      return { depth, chain };
    }
    currentWraps = manifest.wraps;
    currentDir = path.dirname(path.dirname(targetPath)); // .../<proj>/dist/<slug>.html → .../<proj>
  }
  // Unreachable — loop returns or throws inside the body.
  return { depth: MAX_STAGE_DEPTH, chain };
}

/** @deprecated Use assertStageRecursion. */
export const assertPlaygroundRecursion = assertStageRecursion;
