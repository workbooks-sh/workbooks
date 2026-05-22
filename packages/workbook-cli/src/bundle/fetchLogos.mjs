// Logo fetcher — pulls brand SVGs from public CDNs at build time and
// inlines them as base64 data URLs. Cache lives in
// node_modules/.cache/wb-logos so repeat builds skip the network.
//
// Sources, in fan-out order (used by source: "auto" / omitted source):
//   1. lobehub        — AI / dev tools (high quality, narrow coverage)
//   2. svgl           — SaaS / consumer brands (broad)
//   3. iconify-logos  — Iconify's `logos:` collection (broad alt)
//   4. iconify-cib    — CoreUI Brands via Iconify (crypto / smaller)
//   5. devicon        — dev tools, languages, frameworks
//   6. simple         — monochrome, ~3000 brands (last live fallback)
//   7. pack           — bundled curated SVGs for vertical gaps
//                       (pharma / defense / finance / regulators)
//
// Failures degrade gracefully: a single bad logo logs to stderr and is
// omitted. The build never fails on a missing logo.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK_PATH = path.resolve(HERE, "..", "..", "data", "logos-pack.json");

const LOBEHUB_URL = (id) =>
  `https://unpkg.com/@lobehub/icons-static/svg/${encodeURIComponent(id)}.svg`;
// SVGL: direct .svg endpoint. The api.svgl.app/library/<id> JSON
// endpoint 404s for every common slug — only ?search and /categories
// exist on the api subdomain. Themed icons live at <base>-light.svg
// and <base>-dark.svg as separate slugs.
const SVGL_URL = (id) =>
  `https://svgl.app/library/${encodeURIComponent(id)}.svg`;
const SVGL_SEARCH_URL = (query) =>
  `https://api.svgl.app/?search=${encodeURIComponent(query)}`;
const ICONIFY_URL = (collection, name) =>
  `https://api.iconify.design/${collection}/${encodeURIComponent(name)}.svg`;
const DEVICON_URL = (id, variant = "original") =>
  `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${encodeURIComponent(id)}/${encodeURIComponent(id)}-${variant}.svg`;
const SIMPLE_URL = (id) =>
  `https://cdn.simpleicons.org/${encodeURIComponent(id)}`;

// Fan-out chain for source: "auto". Order matters — higher-quality
// sources first. The CLI tries each in turn and stops at the first SVG.
const AUTO_CHAIN = [
  "lobehub",
  "svgl",
  "iconify-logos",
  "iconify-cib",
  "devicon",
  "simple",
  "pack",
];

const KNOWN_SOURCES = new Set([
  "auto",
  "lobehub",
  "svgl",
  "iconify-logos",
  "iconify-cib",
  "devicon",
  "simple",
  "pack",
]);

let _packCache = null;
async function loadPack() {
  if (_packCache !== null) return _packCache;
  try {
    const raw = await fs.readFile(PACK_PATH, "utf8");
    _packCache = JSON.parse(raw);
  } catch {
    _packCache = {};
  }
  return _packCache;
}

async function ensureCacheDir(projectRoot) {
  const dir = path.join(projectRoot, "node_modules", ".cache", "wb-logos");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function cacheKey(source, id) {
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `${source}-${safe}.svg`;
}

async function readCached(cacheDir, key) {
  try {
    return await fs.readFile(path.join(cacheDir, key), "utf8");
  } catch {
    return null;
  }
}

async function writeCached(cacheDir, key, svg) {
  try {
    await fs.writeFile(path.join(cacheDir, key), svg, "utf8");
  } catch (err) {
    process.stderr.write(`[workbook] logos: failed to cache ${key}: ${err?.message ?? err}\n`);
  }
}

// Persistent resolver cache for auto-mode: maps id → resolved source
// (or "missing"). Lets repeat builds skip the failed-source attempts
// and go straight to the source that worked last time.
async function readAutoCache(cacheDir) {
  try {
    const raw = await fs.readFile(path.join(cacheDir, "auto-cache.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeAutoCache(cacheDir, cache) {
  try {
    await fs.writeFile(
      path.join(cacheDir, "auto-cache.json"),
      JSON.stringify(cache, null, 2),
      "utf8",
    );
  } catch (err) {
    process.stderr.write(`[workbook] logos: failed to write auto-cache: ${err?.message ?? err}\n`);
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { accept: "image/svg+xml, application/json;q=0.9, */*;q=0.5" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return await res.json();
}

function looksLikeSvg(text) {
  return typeof text === "string" && text.includes("<svg");
}

async function fetchOne(source, id) {
  if (source === "lobehub") {
    return await fetchText(LOBEHUB_URL(id));
  }
  if (source === "simple") {
    return await fetchText(SIMPLE_URL(id));
  }
  if (source === "iconify-logos") {
    return await fetchText(ICONIFY_URL("logos", id));
  }
  if (source === "iconify-cib") {
    return await fetchText(ICONIFY_URL("cib", id));
  }
  if (source === "devicon") {
    return await fetchText(DEVICON_URL(id));
  }
  if (source === "pack") {
    const pack = await loadPack();
    const entry = pack[id];
    if (!entry || typeof entry.svg !== "string") {
      throw new Error(`pack: '${id}' not in curated pack`);
    }
    return entry.svg;
  }
  if (source === "svgl") {
    try {
      return await fetchText(SVGL_URL(id));
    } catch {
      const results = await fetchJson(SVGL_SEARCH_URL(id));
      const first = Array.isArray(results) ? results[0] : null;
      let route = first?.route;
      if (route && typeof route === "object") {
        route = route.light ?? route.dark ?? null;
      }
      if (typeof route !== "string" || !route) {
        throw new Error(
          `SVGL: '${id}' not found at svgl.app/library/${id}.svg and no search match. ` +
          `Check the slug at https://svgl.app or use ?search=${id} to find the right one.`,
        );
      }
      return await fetchText(route);
    }
  }
  throw new Error(`unknown logo source: ${source}`);
}

// Fan-out resolver for source: "auto". Returns the first SVG any
// source produces + the source name that won. Persists the winner in
// auto-cache so subsequent builds skip the failed sources entirely.
async function fetchAuto(id, cacheDir, autoCache) {
  const cached = autoCache[id];
  if (cached === "missing") {
    throw new Error(
      `auto: '${id}' was not found in any source on a previous build. ` +
      `Delete node_modules/.cache/wb-logos/auto-cache.json (or pass --refresh-logos) to retry.`,
    );
  }
  if (typeof cached === "string" && KNOWN_SOURCES.has(cached) && cached !== "auto") {
    try {
      const svg = await fetchOne(cached, id);
      if (looksLikeSvg(svg)) return { svg, source: cached };
    } catch {
      // Cached source went away — fall through to full chain and re-resolve.
    }
  }

  for (const source of AUTO_CHAIN) {
    try {
      const svg = await fetchOne(source, id);
      if (looksLikeSvg(svg)) {
        autoCache[id] = source;
        await writeAutoCache(cacheDir, autoCache);
        return { svg, source };
      }
    } catch {
      // Try the next source.
    }
  }

  autoCache[id] = "missing";
  await writeAutoCache(cacheDir, autoCache);
  throw new Error(
    `auto: '${id}' not found in any source ` +
    `(${AUTO_CHAIN.join(" → ")}). ` +
    `Add it to the curated pack at ` +
    `packages/workbooks/packages/workbook-cli/data/logos-pack.json — ` +
    `see data/logos-pack/README.md for the contribution process.`,
  );
}

function svgToDataUrl(svg) {
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}

/**
 * Fetch + inline every declared logo. Returns an object keyed by the
 * author's `as` name with `{ dataUrl, svg }` entries. The runtime
 * reads the same shape from `<script id="wb-logos">`.
 *
 *   {
 *     openai: { dataUrl: "data:image/svg+xml;base64,…", svg: "<svg…>" },
 *   }
 *
 * Authors typically omit `source` and let auto-mode pick. Explicit
 * source: stays as an escape hatch when a specific library has a
 * better variant.
 */
export async function fetchAndInlineLogos(logosConfig, projectRoot) {
  if (!Array.isArray(logosConfig) || logosConfig.length === 0) return {};
  const cacheDir = await ensureCacheDir(projectRoot);
  const autoCache = await readAutoCache(cacheDir);
  const out = {};

  for (const entry of logosConfig) {
    const { id, as } = entry;
    const source = entry.source ?? "auto";
    const targetAs = as ?? id;

    let svg;
    let resolvedSource = source;
    if (source === "auto") {
      try {
        const result = await fetchAuto(id, cacheDir, autoCache);
        svg = result.svg;
        resolvedSource = result.source;
      } catch (err) {
        process.stderr.write(`[workbook] logos: ${err?.message ?? err}\n`);
        continue;
      }
    } else {
      const key = cacheKey(source, id);
      svg = await readCached(cacheDir, key);
      if (svg == null) {
        try {
          svg = await fetchOne(source, id);
          if (!looksLikeSvg(svg)) {
            throw new Error(`response did not look like an SVG`);
          }
          await writeCached(cacheDir, key, svg);
        } catch (err) {
          process.stderr.write(
            `[workbook] logos: skipped ${source}:${id} — ${err?.message ?? err}\n`,
          );
          continue;
        }
      }
    }

    out[targetAs] = { dataUrl: svgToDataUrl(svg), svg };
    if (source === "auto") {
      process.stderr.write(`[workbook] logos: ${id} → ${resolvedSource}\n`);
    }
  }

  return out;
}
