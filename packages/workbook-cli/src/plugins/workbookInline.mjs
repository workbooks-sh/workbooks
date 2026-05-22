// Vite plugin: inject the workbook runtime + spec into the final
// HTML at build (and serve a small dev-mode shim in dev).
//
// Two phases:
//   1. transformIndexHtml — runs in both dev + build. We add the
//      workbook-spec script tag (manifest as JSON) and a banner
//      that tells the user this is a workbook.
//   2. closeBundle — only in build. After Vite has emitted the
//      bundled HTML, we rewrite it to inline wasm + bindgen + bundle
//      as <script type="text/plain"> blocks (the "portable assets"
//      block).
//
// In dev mode we DON'T inline the wasm — instead, the dev page
// imports from the runtime-wasm pkg/ directly via a virtual module.
// That keeps reload fast and avoids re-encoding 13 MB of base64 on
// every save.

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveRuntime, readRuntimeAssets } from "../util/runtime.mjs";
import { checkVariant, pickVariantFromSource } from "../util/variantCheck.mjs";
import { dceWasm } from "../util/wasmDce.mjs";
import {
  escapeForScript,
  makeSentinels,
  makeAssetTag,
  TRIGGER,
  SLOT_PORTABLE,
} from "../util/triggerSafe.mjs";
import { brotliWrapHtml } from "../util/compress.mjs";
import { buildAgentScriptTag, buildSkillsPayload } from "../util/buildAgent.mjs";
import { buildAgentComponents } from "../util/buildAgentComponents.mjs";
import { assertIframeInvariant } from "../checks/iframeInvariant.mjs";
import { buildWrappedTag } from "../bundle/embedWrapped.mjs";
import { fetchAndInlineLogos } from "../bundle/fetchLogos.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ICON_PATH = path.resolve(HERE, "..", "..", "templates", "default-icon.svg");
const ABOUT_TOAST_PATH = path.resolve(HERE, "..", "runtime-inject", "aboutToast.mjs");

let _aboutToastSrc = null;
async function readAboutToast() {
  if (_aboutToastSrc !== null) return _aboutToastSrc;
  _aboutToastSrc = await fs.readFile(ABOUT_TOAST_PATH, "utf8");
  return _aboutToastSrc;
}

function makeAboutToastSentinels() {
  return {
    BEGIN: "<!-- BEGIN workbook-about-toast -->",
    END: "<!-- END workbook-about-toast -->",
  };
}

// ----------------------------------------------------------------------
// Head-injection helpers — closes core-bii.
//
// The previous regex-based injector used a plain `</head>` lookup. That
// regex is unaware of JS scoping: if a user's bundled JS contains the
// substring "</head>" inside a template literal (legitimate in iframe
// srcdoc helpers and similar HTML-emitting code), the injector would
// land ~16 MB of base64 wasm INSIDE that template literal, severing
// the JS expression and corrupting the entire bundle.
//
// Fix: SLOT_PORTABLE — a unique sentinel comment — is emitted into
// the document head during the early HTML transform (order: "pre",
// before vite-plugin-singlefile inlines the user JS bundle). Later
// asset-injection passes anchor on the slot instead of </head>; by
// construction the slot lives outside any user code. The </head>
// regex is retained as a fallback only for HTML inputs that bypass
// transformIndexHtml entirely.
// ----------------------------------------------------------------------

/** Inject `content` into the document head. Prefers the SLOT_PORTABLE
 *  sentinel (placed during transformIndexHtml at order "pre") as the
 *  anchor. Falls back to a </head> regex for HTML inputs that haven't
 *  been through the slot-emitting transform. */
function injectIntoHead(html, content, { consumeSlot = false } = {}) {
  // String.replace(str, str) runs `$$`/`$&`/`$1` substitution on the
  // replacement. The inlined runtime bundle contains identifiers like
  // `$$constructedBy` (lib0/schema.js); without a function replacement
  // those get collapsed to `$constructedBy`, shadowing the arrow that
  // defined them and breaking the bundle at module-eval time.
  if (html.includes(SLOT_PORTABLE)) {
    const replacement = consumeSlot ? content : content + "\n" + SLOT_PORTABLE;
    return html.replace(SLOT_PORTABLE, () => replacement);
  }
  const headClose = TRIGGER.HEAD_CLOSE();
  if (html.toLowerCase().includes(headClose)) {
    return html.replace(new RegExp(headClose, "i"), () => content + "\n" + headClose);
  }
  // No </head> — fall back to splice-after-doctype-and-html-open so we
  // don't break parse5 with content above the doctype. Real authors
  // (and eval setup fixtures) often skip <head> entirely, expecting
  // it to be auto-synthesized; do that here.
  return spliceContentAfterHtmlOpen(html, content);
}

/** Ensure SLOT_PORTABLE is present in the document head. Idempotent
 *  — calling on an HTML that already has the slot returns it unchanged. */
function ensureSlot(html) {
  if (html.includes(SLOT_PORTABLE)) return html;
  const headClose = TRIGGER.HEAD_CLOSE();
  if (html.toLowerCase().includes(headClose)) {
    return html.replace(new RegExp(headClose, "i"), () => SLOT_PORTABLE + "\n" + headClose);
  }
  return spliceContentAfterHtmlOpen(html, SLOT_PORTABLE);
}

/** When HTML has no </head>, the injection has to land somewhere
 *  parse5 still accepts. Prepending to the very top puts content
 *  above the <!DOCTYPE>, which parse5 rejects with
 *  'misplaced-doctype'. Instead, synthesize a <head> right after the
 *  <html> opening tag — that's where the browser would auto-create
 *  one anyway.
 *
 *  Order of preference:
 *    1. After the opening <html> tag (creates a real <head>)
 *    2. Before <body> (creates a head wrapper before body)
 *    3. After the doctype line (last resort)
 *    4. Append at end (pathological — no html structure at all) */
function spliceContentAfterHtmlOpen(html, content) {
  const htmlOpen = /<html[^>]*>/i;
  const m = html.match(htmlOpen);
  if (m && typeof m.index === "number") {
    const idx = m.index + m[0].length;
    return html.slice(0, idx) + "\n<head>\n" + content + "\n</head>" + html.slice(idx);
  }
  const bodyOpen = /<body[^>]*>/i;
  const bm = html.match(bodyOpen);
  if (bm && typeof bm.index === "number") {
    return html.slice(0, bm.index) + "<head>\n" + content + "\n</head>\n" + html.slice(bm.index);
  }
  const doctype = /<!doctype[^>]*>/i;
  const dm = html.match(doctype);
  if (dm && typeof dm.index === "number") {
    const idx = dm.index + dm[0].length;
    return html.slice(0, idx) + "\n" + content + html.slice(idx);
  }
  return html + "\n" + content;
}

// ----------------------------------------------------------------------
// Pure HTML transforms — used by both the Vite plugin (build path with
// component compilation) and the singleFile build path (hand-written
// HTML, no Vite). Keep these side-effect-free; callers handle I/O.
// ----------------------------------------------------------------------

/** Inject favicon link tags (data-URL inlined) and the workbook-spec
 *  JSON script into the document head. Skips favicon injection if the
 *  page already declares one. Idempotent — running twice is a no-op.
 *  Also ensures SLOT_PORTABLE is present so a subsequent
 *  inlinePortableAssets pass can anchor on it (closes core-bii). */
export async function injectSpecAndIcons(html, config) {
  const hasUserIcon = /<link\s[^>]*rel\s*=\s*["']?(?:icon|shortcut icon)["']?/i.test(html);
  const iconLinks = hasUserIcon ? "" : await buildIconLinks(config);

  // Skip if already injected (singleFile re-builds).
  if (/<script id="workbook-spec"[^>]*>/.test(html)) return ensureSlot(html);

  const spec = buildSpec(config);
  const specJson = escapeForScript(JSON.stringify(spec));
  const tagOpen = TRIGGER.TAG_SCRIPT_OPEN();
  const tagEnd = TRIGGER.TAG_SCRIPT_END();
  const specTag =
    `${tagOpen} id="workbook-spec" type="application/json">${specJson}${tagEnd}`;
  const capabilitiesTag = buildCapabilitiesTag(config, tagOpen, tagEnd);
  const databasesTag = buildDatabasesTag(config, tagOpen, tagEnd);
  const databasesBakedTag = buildDatabasesBakedTag(config, tagOpen, tagEnd);
  const hostTag = buildHostTag(config, tagOpen, tagEnd);
  const paramsTag = buildParamsTag(config, tagOpen, tagEnd);
  const agentTag = config.type === "agent" ? buildAgentScriptTag(config, escapeForScript) : "";
  let componentsTag = "";
  let skillsTag = "";
  if (config.type === "agent") {
    const { scriptJson } = await buildAgentComponents(config);
    if (scriptJson) {
      const names = Object.keys(JSON.parse(scriptJson)).join(",");
      componentsTag =
        `${tagOpen} id="wb-components"` +
        ` type="application/x-workbook-components"` +
        ` data-version="1"` +
        ` data-names="${names}">` +
        escapeForScript(scriptJson) +
        tagEnd;
    }
    const skills = await buildSkillsPayload(config);
    if (skills) {
      skillsTag =
        `${tagOpen} id="wb-skills"` +
        ` type="application/x-workbook-skills"` +
        ` data-version="1">` +
        escapeForScript(JSON.stringify(skills)) +
        tagEnd;
    }
  }
  const injection =
    (iconLinks ? iconLinks + "\n" : "") +
    specTag +
    (capabilitiesTag ? "\n" + capabilitiesTag : "") +
    (databasesTag ? "\n" + databasesTag : "") +
    (databasesBakedTag ? "\n" + databasesBakedTag : "") +
    (hostTag ? "\n" + hostTag : "") +
    (paramsTag ? "\n" + paramsTag : "") +
    (agentTag ? "\n" + agentTag : "") +
    (componentsTag ? "\n" + componentsTag : "") +
    (skillsTag ? "\n" + skillsTag : "");
  // Make sure the slot exists, then inject above it. Slot stays —
  // inlinePortableAssets uses it as its own anchor.
  return injectIntoHead(ensureSlot(html), injection);
}

/** Inline the wasm-bindgen JS, runtime bundle JS, and wasm bytes as
 *  <script type="text/plain"> blocks in the head, between sentinels.
 *  Replaces a prior block if present. Anchors on SLOT_PORTABLE
 *  (closes core-bii) — the slot is consumed at this point because
 *  no further injection passes need it. */
export async function inlinePortableAssets(html, runtime) {
  const assets = await readRuntimeAssets(runtime);
  const { BEGIN, END } = makeSentinels();
  const block = [
    makeAssetTag("wasm-b64", "text/plain", assets.wasmB64),
    makeAssetTag("bindgen-src", "text/plain", escapeForScript(assets.bindgenJs)),
    makeAssetTag("runtime-bundle-src", "text/plain", escapeForScript(assets.bundleSrc)),
  ].join("\n");
  const wrapped = `${BEGIN}\n${block}\n${END}`;

  // Replace prior block if present (re-runs).
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const priorRe = new RegExp(
    escapeRe(BEGIN) + "[\\s\\S]*?" + escapeRe(END),
    "i",
  );
  // Function replacement bypasses `$$`/`$&` substitution that would
  // otherwise mangle bundle identifiers like `$$constructedBy`.
  if (priorRe.test(html)) return html.replace(priorRe, () => wrapped);

  return injectIntoHead(html, wrapped, { consumeSlot: true });
}

/** Replace <link rel="stylesheet" href="..."> tags with inlined
 *  <style> blocks. href must be relative; absolute URLs are skipped.
 *  Used by the singleFile build path so a hand-written example with
 *  `<link href="../_shared/design.css">` produces a portable HTML
 *  with that CSS inlined. */
export async function inlineLinkedStylesheets(html, sourceDir) {
  const re = /<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
  const matches = [...html.matchAll(re)];
  if (!matches.length) return html;

  const replacements = await Promise.all(matches.map(async (m) => {
    const tag = m[0];
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) return { tag, replacement: tag };
    const href = hrefMatch[1];
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("//")) {
      return { tag, replacement: tag }; // external URL — leave alone
    }
    const abs = path.resolve(sourceDir, href);
    try {
      const css = await fs.readFile(abs, "utf8");
      const idMatch = tag.match(/id\s*=\s*["']([^"']+)["']/i);
      const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
      return { tag, replacement: `<style${idAttr}>${css}</style>` };
    } catch {
      return { tag, replacement: tag }; // unresolvable — leave alone
    }
  }));

  let out = html;
  for (const { tag, replacement } of replacements) {
    if (tag !== replacement) out = out.replace(tag, () => replacement);
  }
  return out;
}

const VIRTUAL_RUNTIME_ID = "virtual:workbook-runtime";
const RESOLVED_RUNTIME_ID = "\0" + VIRTUAL_RUNTIME_ID;

// Runtime loader. Lives inside the virtual module so it ships with
// the user's bundle. Detects portable mode (inlined assets) vs dev
// mode (HTTP fetch) and returns { wasm, bundle, initWasm }.
const RUNTIME_LOADER_SRC = String.raw`
let _cached;

function base64ToBytes(b64) {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadRuntime() {
  if (_cached) return _cached;
  const refsEl = typeof document !== "undefined" ? document.getElementById("wb-wasm-refs") : null;
  const wasmEl = typeof document !== "undefined" ? document.getElementById("wasm-b64") : null;
  const bindgenEl = typeof document !== "undefined" ? document.getElementById("bindgen-src") : null;
  const bundleEl = typeof document !== "undefined" ? document.getElementById("runtime-bundle-src") : null;
  const portable = wasmEl && bindgenEl && bundleEl && wasmEl.textContent.trim().length > 0;
  const referenced = refsEl && refsEl.textContent && refsEl.textContent.trim().length > 0;

  let wasm, bundle;
  if (referenced) {
    // Reference mode (wb-e19.10): fetch runtime assets from a CDN
    // rather than reading them out of inlined script tags. The CDN
    // layout mirrors the wasm-pack pkg-<variant>/ output:
    //   <baseUrl>/<variant>/bindgen.js
    //   <baseUrl>/<variant>/runtime.wasm
    //   <baseUrl>/<variant>/bundle.js
    const refs = JSON.parse(refsEl.textContent);
    const baseUrl = String(refs.baseUrl || "").replace(/\/+$/, "");
    const variant = String(refs.variant || "minimal");
    const prefix = baseUrl + "/" + variant;
    const [bindgenSrc, wasmBuf, bundleSrc] = await Promise.all([
      fetch(prefix + "/bindgen.js").then((r) => {
        if (!r.ok) throw new Error("workbook runtime fetch failed: bindgen.js " + r.status);
        return r.text();
      }),
      fetch(prefix + "/runtime.wasm").then((r) => {
        if (!r.ok) throw new Error("workbook runtime fetch failed: runtime.wasm " + r.status);
        return r.arrayBuffer();
      }),
      fetch(prefix + "/bundle.js").then((r) => {
        if (!r.ok) throw new Error("workbook runtime fetch failed: bundle.js " + r.status);
        return r.text();
      }),
    ]);
    const bindgenUrl = URL.createObjectURL(new Blob([bindgenSrc], { type: "application/javascript" }));
    wasm = await import(/* @vite-ignore */ bindgenUrl);
    await wasm.default({ module_or_path: new Uint8Array(wasmBuf) });
    URL.revokeObjectURL(bindgenUrl);
    const bundleUrl = URL.createObjectURL(new Blob([bundleSrc], { type: "application/javascript" }));
    bundle = await import(/* @vite-ignore */ bundleUrl);
    URL.revokeObjectURL(bundleUrl);
  } else if (portable) {
    const wasmBytes = base64ToBytes(wasmEl.textContent);
    const bindgenUrl = URL.createObjectURL(new Blob([bindgenEl.textContent], { type: "application/javascript" }));
    wasm = await import(/* @vite-ignore */ bindgenUrl);
    // wasm-bindgen 0.2.93+ deprecates the positional init form. The
    // object form (module_or_path) is supported back to ~0.2.86, so
    // it works against any runtime we're realistically going to ship.
    await wasm.default({ module_or_path: wasmBytes });
    URL.revokeObjectURL(bindgenUrl);
    const bundleUrl = URL.createObjectURL(new Blob([bundleEl.textContent], { type: "application/javascript" }));
    bundle = await import(/* @vite-ignore */ bundleUrl);
    URL.revokeObjectURL(bundleUrl);
  } else {
    // Build URLs at runtime so the bundler doesn't try to resolve them.
    const base = "/" + "_" + "_workbook/";
    wasm = await import(/* @vite-ignore */ base + "bindgen.js");
    await wasm.default({ module_or_path: base + "runtime.wasm" });
    bundle = await import(/* @vite-ignore */ base + "bundle.js");
  }
  _cached = { wasm, bundle };
  return _cached;
}

async function initWasm() { return (await loadRuntime()).wasm; }

export { loadRuntime, initWasm };
export default loadRuntime;
`;

export default function workbookInline({ config, runtimeOverride } = {}) {
  let runtime = null;
  let resolvedConfig = null;

  return {
    name: "workbook-inline",
    enforce: "post",

    async configResolved(c) {
      resolvedConfig = c;
      // When inlining is disabled (e.g. `workbook build --no-wasm` for
      // SPA workbooks that don't embed the runtime), skip the runtime
      // resolve entirely. Otherwise the build fails with "could not
      // locate workbook-runtime-wasm pkg/ output" even though the
      // resolved bytes are never used. The downstream `transformIndexHtml`
      // already short-circuits at `inlineRuntime === false`.
      if (config.inlineRuntime === false) return;
      /* Auto-pick the smallest viable wasmVariant when the user
       * didn't set one explicitly. Source-tree scan reads every
       * .svelte/.ts/.mjs file under projectRoot and asks "does it
       * reference a symbol heavier variants ship that smaller ones
       * don't?" — picks the smallest covering variant. False
       * positives only push it larger, never break the build.
       * Explicit `wasmVariant: "..."` in config skips this. See wb-a4c. */
      const variantWasExplicit = config.wasmVariant !== undefined;
      let effectiveVariant = config.wasmVariant;
      let pickedSymbols = null;
      if (!variantWasExplicit) {
        /* Need to know runtimeDir before the variant pick; resolve at
         * "default" just to read d.ts files, then re-resolve at the
         * chosen variant below for the actual build. Cheap (no wasm
         * inline yet) — resolveRuntime is just file-system locate. */
        const probe = await resolveRuntime({
          override: runtimeOverride,
          variant: "default",
          quiet: true,
        });
        if (probe.runtimeWasm) {
          const picked = await pickVariantFromSource({
            runtimeDir: probe.runtimeWasm,
            projectRoot: config.root,
          });
          effectiveVariant = picked.variant;
          pickedSymbols = picked.symbols;
          process.stdout.write(
            `[workbook] auto-selected wasmVariant: "${picked.variant}" ` +
              `(scanned ${picked.scanned} file${picked.scanned === 1 ? "" : "s"}, ` +
              `${picked.usedSymbols} wasm symbol${picked.usedSymbols === 1 ? "" : "s"} ` +
              `referenced). Set wasmVariant in workbook.config.mjs to override.\n`,
          );
        } else {
          effectiveVariant = "default";
        }
      }
      /* Track on the config so subsequent stages (the post-bundle
       * variantCheck, log messages) know what's actually shipping
       * and whether the user explicitly chose it. */
      config.wasmVariant = effectiveVariant;
      config.wasmVariantExplicit = variantWasExplicit;
      runtime = await resolveRuntime({
        override: runtimeOverride,
        variant: effectiveVariant,
      });

      /* Per-workbook WASM dead-code elimination. When auto-pick gave
       * us a concrete used-symbol set AND the variant ships any
       * wasm at all, ask binaryen to strip every export the workbook
       * doesn't reference and run --dce. Result swaps in via
       * runtime.wasmPath so the rest of the pipeline (readRuntimeAssets,
       * SLOT_PORTABLE wasm inline) picks up the sliced bytes
       * transparently. Best-effort: any binaryen failure falls back
       * to the source binary silently. wb-m1r. */
      if (
        runtime &&
        runtime.wasmPath &&
        effectiveVariant !== "none" &&
        pickedSymbols &&
        pickedSymbols.size > 0 &&
        config.wasmDce !== false
      ) {
        try {
          const beforeStat = await fs.stat(runtime.wasmPath);
          const slicedPath = await dceWasm({
            sourceWasmPath: runtime.wasmPath,
            variant: effectiveVariant,
            usedSymbols: pickedSymbols,
          });
          if (slicedPath !== runtime.wasmPath) {
            const afterStat = await fs.stat(slicedPath);
            const before = (beforeStat.size / 1024).toFixed(1);
            const after = (afterStat.size / 1024).toFixed(1);
            const pct = ((afterStat.size / beforeStat.size) * 100).toFixed(0);
            process.stdout.write(
              `[workbook] wasm-dce: ${before} KB → ${after} KB (${pct}% of source) ` +
                `keeping ${pickedSymbols.size} exported symbol${pickedSymbols.size === 1 ? "" : "s"}\n`,
            );
            runtime = { ...runtime, wasmPath: slicedPath };
          }
        } catch (err) {
          process.stderr.write(`[workbook] wasm-dce skipped: ${err?.message ?? err}\n`);
        }
      }
    },

    /**
     * Provide a virtual module so user code can do:
     *
     *   import { loadRuntime } from "virtual:workbook-runtime";
     *   const { wasm, bundle } = await loadRuntime();
     *   const out = wasm.runPolarsSql(sql, csv);
     *
     * Why a loader instead of direct imports: the runtime bundle has
     * optional peer deps (deck.gl, mermaid, plotly, etc.) that should NOT be
     * bundled into the user's app at build time. We inline the
     * runtime bundle JS as a side asset and import it at use time
     * via blob URLs. This also keeps the *user code* small even when
     * the runtime is heavy.
     *
     * In dev: the loader fetches /__workbook/<file> served by our
     * dev middleware (relative to the runtime-wasm package).
     * In build: the loader reads the inlined <script id> blocks and
     * imports via URL.createObjectURL.
     */
    resolveId(id) {
      if (id === VIRTUAL_RUNTIME_ID) return RESOLVED_RUNTIME_ID;
    },
    async load(id) {
      if (id !== RESOLVED_RUNTIME_ID) return;
      return RUNTIME_LOADER_SRC;
    },

    // Dev middleware: serve the runtime files at /__workbook/...
    // so dev mode can fetch them without us pre-encoding base64.
    configureServer(server) {
      const PREFIX = "/__workbook/";
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith(PREFIX)) return next();
        const slug = req.url.slice(PREFIX.length).split("?")[0];
        let target = null;
        if (slug === "bindgen.js") target = runtime.bindgenPath;
        else if (slug === "bundle.js") target = runtime.bundlePath;
        else if (slug === "runtime.wasm") target = runtime.wasmPath;
        if (!target) return next();
        try {
          const data = await fs.readFile(target);
          if (slug === "runtime.wasm") {
            res.setHeader("Content-Type", "application/wasm");
          } else {
            res.setHeader("Content-Type", "application/javascript");
            // Strip wasm-bindgen URL line for bindgen, same as build path.
            if (slug === "bindgen.js") {
              const stripped = data.toString("utf8").replace(
                /new URL\([\s\S]*?import\.meta\.url\)/g,
                "undefined /* stripped */",
              );
              return res.end(stripped);
            }
          }
          res.end(data);
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e?.message ?? e));
        }
      });
    },

    /** Inject the workbook-spec script + favicon links + the
     *  SLOT_PORTABLE anchor (closes core-bii). Runs at order "pre" so
     *  it sees the source HTML BEFORE viteSingleFile inlines the user
     *  JS bundle into <body>. The slot lands in <head>; later
     *  writeBundle uses it as the asset-injection anchor instead of a
     *  </head> regex that could match inside a JS template literal. */
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        // Skip injection if the host page already has its own favicon
        // links — let the author opt out by simply declaring them.
        const hasUserIcon = /<link\s[^>]*rel\s*=\s*["']?(?:icon|shortcut icon)["']?/i.test(html);
        const iconLinks = hasUserIcon
          ? ""
          : await buildIconLinks(config);

        const spec = buildSpec(config);
        const specJson = escapeForScript(JSON.stringify(spec));
        const tagOpen = TRIGGER.TAG_SCRIPT_OPEN();
        const tagEnd = TRIGGER.TAG_SCRIPT_END();
        const specTag =
          `${tagOpen} id="workbook-spec" type="application/json">${specJson}${tagEnd}`;
        const capabilitiesTag = buildCapabilitiesTag(config, tagOpen, tagEnd);
        const databasesTag = buildDatabasesTag(config, tagOpen, tagEnd);
        const databasesBakedTag = buildDatabasesBakedTag(config, tagOpen, tagEnd);
        const hostTag = buildHostTag(config, tagOpen, tagEnd);
        const paramsTag = buildParamsTag(config, tagOpen, tagEnd);

        // Dark Reader auto-lock — Dark Reader (and similar extensions)
        // inject `--darkreader-*` CSS vars and rewrite color values,
        // which mangles author-controlled palettes (especially Svelte
        // apps with prefers-color-scheme contracts). The standard
        // defense is `<meta name="darkreader-lock">`, which the
        // extension respects. Authors can opt out by declaring their
        // own meta with a different name, or `darkreader-allow`.
        const hasDarkReaderMeta = /<meta\s[^>]*name\s*=\s*["']?darkreader[\w-]*/i.test(html);
        const darkReaderLock = hasDarkReaderMeta
          ? ""
          : `<meta name="darkreader-lock">`;

        // wb-build-mode — production vs dev. Drives the runtime's
        // Studio-required policy: a connected workbook (declared
        // databases / integrations / connect) in production mode that
        // can't reach a host renders a takeover splash instead of the
        // first-run config panel. Dev mode (workbook dev) trusts that
        // workbook.local.json + the baked block deliver creds locally,
        // so it skips the splash.
        const buildMode =
          resolvedConfig?.command === "build" ? "production" : "dev";
        const buildModeTag = `<meta name="wb-build-mode" content="${buildMode}">`;

        // wb-floater opt-out — emitted only when explicitly disabled.
        // Runtime reads this meta to no-op floater.add() at the source
        // so author code never sees the surface. wb-721.3.
        const floaterTag = config.floater === false
          ? `<meta name="wb-floater" content="off">`
          : "";

        // Workbook baseline — minimal reset that fixes the "h-full
        // doesn't work without Tailwind" trap and normalizes form-
        // element borders. Authors who set their own html/body height
        // override these via specificity. id=`wb-baseline-style` so it's
        // identifiable + idempotent (re-injection won't duplicate).
        const hasBaseline = /id\s*=\s*["']?wb-baseline-style["']?/i.test(html);
        // Theme-aware CSS variables shipped in the baseline. Authors
        // reference these via var(--color-page) etc. and get
        // system-aware dark mode for free — no per-workbook
        // prefers-color-scheme media queries needed. Mirrors the same
        // token set Studio's app.css uses so workbooks embedded in
        // Studio render consistently with the chrome. wb-yufs.1.
        // The `theme` config knob (light | dark | system, default
        // "system") locks the rendered color-scheme regardless of
        // OS preference — for standalone artifacts that must look
        // the same everywhere.
        const themeMode =
          config.theme === "light" || config.theme === "dark"
            ? config.theme
            : "system";
        const colorSchemeDecl =
          themeMode === "light"
            ? "color-scheme:light"
            : themeMode === "dark"
              ? "color-scheme:dark"
              : "color-scheme:light dark";
        const baseline = hasBaseline
          ? ""
          : `<style id="wb-baseline-style">
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%;margin:0;padding:0}
body{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;background:var(--color-page);color:var(--color-fg)}
button,input,select,textarea{font:inherit;color:inherit}
button{background:transparent;border:0;padding:0;cursor:pointer}
:root{${colorSchemeDecl};--color-page:#fafafa;--color-surface:#ffffff;--color-surface-soft:#f4f4f5;--color-fg:#0f0f0f;--color-fg-muted:#525252;--color-border:#e4e4e7;--color-accent:#4f46e5;--color-success:#047857;--color-warn:#b45309;--color-error:#dc2626;--radius-sm:4px;--radius-md:8px;--radius-lg:12px}
${themeMode === "system"
            ? `@media (prefers-color-scheme: dark){:root{--color-page:#1a1a1f;--color-surface:#25252b;--color-surface-soft:#2f2f36;--color-fg:#f4f4f5;--color-fg-muted:#a1a1aa;--color-border:#3f3f46;--color-accent:#818cf8;--color-success:#34d399;--color-warn:#fbbf24;--color-error:#f87171}}`
            : themeMode === "dark"
              ? `:root{--color-page:#1a1a1f;--color-surface:#25252b;--color-surface-soft:#2f2f36;--color-fg:#f4f4f5;--color-fg-muted:#a1a1aa;--color-border:#3f3f46;--color-accent:#818cf8;--color-success:#34d399;--color-warn:#fbbf24;--color-error:#f87171}`
              : ""}
</style>`;

        const agentTag = config.type === "agent" ? buildAgentScriptTag(config, escapeForScript) : "";
        let componentsTag = "";
        let skillsTag = "";
        if (config.type === "agent") {
          const { scriptJson } = await buildAgentComponents(config);
          if (scriptJson) {
            const names = Object.keys(JSON.parse(scriptJson)).join(",");
            componentsTag =
              `${tagOpen} id="wb-components"` +
              ` type="application/x-workbook-components"` +
              ` data-version="1"` +
              ` data-names="${names}">` +
              escapeForScript(scriptJson) +
              tagEnd;
          }
          const skills = await buildSkillsPayload(config);
          if (skills) {
            skillsTag =
              `${tagOpen} id="wb-skills"` +
              ` type="application/x-workbook-skills"` +
              ` data-version="1">` +
              escapeForScript(JSON.stringify(skills)) +
              tagEnd;
          }
        }
        const injection = [
          darkReaderLock,
          buildModeTag,
          floaterTag,
          baseline,
          iconLinks,
          specTag,
          capabilitiesTag,
          databasesTag,
          databasesBakedTag,
          hostTag,
          paramsTag,
          agentTag,
          componentsTag,
          skillsTag,
        ]
          .filter(Boolean)
          .join("\n");
        // Place the slot first, then inject spec/icons before it. The
        // slot stays in place for the writeBundle pass.
        return injectIntoHead(ensureSlot(html), injection);
      },
    },

    /** Build only: inline wasm + bindgen + bundle into the emitted
     * HTML so the resulting file runs without any siblings. We use
     * writeBundle (not closeBundle) and enforce: post above so this
     * runs AFTER other plugins (vite-plugin-singlefile) have written
     * the HTML to disk. */
    async writeBundle() {
      if (resolvedConfig.command !== "build") return;
      if (config.inlineRuntime === false) return;

      const outDir = resolvedConfig.build.outDir;
      try { await fs.access(outDir); }
      catch {
        process.stderr.write(`[workbook] outDir ${outDir} does not exist; skipping inline.\n`);
        return;
      }
      const htmlFiles = await collectHtml(outDir);
      if (!htmlFiles.length) {
        process.stderr.write(`[workbook] no .html files in ${outDir}; skipping inline.\n`);
        return;
      }

      // wasmVariant: "none" — author opted out of the wasm surface entirely.
      // Emit every other head block (spec, source-bundle, capabilities,
      // params, save handler, toasts) but skip wasm-b64 / bindgen-src /
      // runtime-bundle-src. Cuts ~200KB-20MB depending on the variant
      // we'd otherwise have inlined.
      const skipWasm = config.wasmVariant === "none" || runtime?.skipInline === true;

      // wasm.strategy === "reference" — author opted into CDN fetch
      // rather than bundling. We skip the wasm-b64/bindgen-src/
      // runtime-bundle-src tags and emit a wb-wasm-refs metadata tag
      // pointing the runtime at the CDN base URL. Warn loudly — this
      // breaks single-file portability and authors should know.
      // wb-e19.10.
      const referenceWasm =
        !skipWasm &&
        config.wasm?.strategy === "reference" &&
        typeof config.wasm.cdnBaseUrl === "string";
      if (referenceWasm) {
        process.stderr.write(
          `[workbook] wasm.strategy="reference": runtime assets will be fetched from ${config.wasm.cdnBaseUrl} at boot.\n` +
            `[workbook] WARNING — this breaks single-file portability. Recipients need network access on cold load.\n` +
            `[workbook] Switch back to wasm.strategy="bundle" (default) to keep the artifact self-contained.\n`,
        );
      }

      const assets = skipWasm || referenceWasm ? null : await readRuntimeAssets(runtime);
      const { BEGIN, END } = makeSentinels();

      // About toast — fixed bottom-right chip with author name + a
      // link to workbooks.sh. Reads manifest.author from the baked
      // workbook-spec JSON at runtime; suppresses itself if author is
      // unset (so the toggle is the presence of config.author, no
      // separate enabled flag needed). Suppresses inside iframes
      // (workbooks.sh splash already shows identity in the parent).
      const aboutToastEnabled = typeof config.author === "string" && config.author.length > 0;
      const aboutToastSrc = aboutToastEnabled ? await readAboutToast() : null;
      const { BEGIN: ABOUT_BEGIN, END: ABOUT_END } = makeAboutToastSentinels();
      const aboutToastBlock = aboutToastSrc
        ? `${ABOUT_BEGIN}\n<script>${escapeForScript(aboutToastSrc)}</script>\n${ABOUT_END}`
        : "";

      const portableBlock = skipWasm
        ? ""
        : referenceWasm
        ? // Reference mode — emit the CDN pointer instead of the inlined
          // bytes. Variant is what the runtime/CLI picked (none / minimal
          // / app); the CDN layout is expected to mirror pkg-* subdirs.
          `<script id="wb-wasm-refs"` +
          ` type="application/x-workbook-wasm-refs"` +
          ` data-version="1">` +
          escapeForScript(
            JSON.stringify({
              baseUrl: config.wasm.cdnBaseUrl,
              variant: config.wasm.variant ?? config.wasmVariant ?? "minimal",
            }),
          ) +
          `</script>`
        : [
            makeAssetTag("wasm-b64", "text/plain", assets.wasmB64),
            makeAssetTag("bindgen-src", "text/plain", escapeForScript(assets.bindgenJs)),
            makeAssetTag("runtime-bundle-src", "text/plain", escapeForScript(assets.bundleSrc)),
          ].join("\n");

      // Logos — declared brand SVGs (LobeHub / SVGL / Simple Icons).
      // Fetched at build only (skipping dev avoids hitting the
      // registries on every save), inlined as base64 data URLs in a
      // <script id="wb-logos"> tag. Runtime reads via wb.logos.<as>.
      // Failures degrade gracefully — see fetchAndInlineLogos.
      const logosList = Array.isArray(config.logos) ? config.logos : [];
      let logosBlock = "";
      if (logosList.length > 0) {
        const payload = await fetchAndInlineLogos(logosList, config.root);
        const names = Object.keys(payload);
        if (names.length > 0) {
          logosBlock =
            `<script id="wb-logos"` +
            ` type="application/json"` +
            ` data-version="1"` +
            ` data-count="${names.length}">` +
            escapeForScript(JSON.stringify(payload)) +
            `</script>`;
        }
      }

      // Integrations the workbook declares it needs at runtime.
      // Toolkit slugs (gmail, github, …). The hosted viewer reads this
      // and prompts the recipient to connect each one via Studio →
      // Integrations before running any tool calls. Plain JSON in a
      // <script id="wb-integrations"> tag; empty → omit.
      const integrationsList = Array.isArray(config.integrations)
        ? config.integrations
        : [];
      const integrationsBlock = integrationsList.length === 0
        ? ""
        : `<script id="wb-integrations" type="application/json">${
            escapeForScript(JSON.stringify(integrationsList))
          }</script>`;

      const wasmBlock = skipWasm ? "" : `${BEGIN}\n${portableBlock}\n${END}`;
      /* Stage: fetch the wraps target at build time and embed the
       * bytes inline. Runtime Playground.svelte renders from srcdoc
       * when present, sidestepping the cross-origin / auth chain that
       * bites src=https://workbooks.sh/... See wb-22u.18. */
      let wrappedBlock = "";
      if (config.stage?.wraps) {
        try {
          wrappedBlock = await buildWrappedTag({
            wraps: config.stage.wraps,
            projectRoot: config.root,
          });
        } catch (err) {
          process.stderr.write(
            `[workbook] stage.wraps embed failed: ${err?.message ?? err}\n` +
              `         The stage will fall back to src=URL at runtime.\n`,
          );
        }
      }
      const headBlocks = [
        logosBlock,
        integrationsBlock,
        aboutToastBlock,
        wasmBlock,
        wrappedBlock,
      ]
        .filter(Boolean)
        .join("\n");
      const wrapped = headBlocks;

      // Phase 4: compression sandwich. Default ON; opt out via
      // workbook.config.compress = false. Wraps the finalized HTML
      // in a self-decompressing shim that reduces the on-disk payload
      // ~70-75% on minified JS. Format defaults to "gzip" (universal
      // DecompressionStream support since 2022); "br" is ~5-10%
      // smaller but lands only in Chrome 138+ / Safari 17.6+.
      const compressEnabled = config.compress !== false;
      const compressFormat = typeof config.compress === "string" ? config.compress : "gzip";

      for (const file of htmlFiles) {
        let src = await fs.readFile(file, "utf8");

        // Variant-coverage check — runs against the bundled JS
        // BEFORE the wasm bytes are injected (so we don't grep our
        // own d.ts strings). Best-effort regex match; warnings only,
        // never blocks the build. Disable per-workbook with
        // `wasmVariantCheck: false` (e.g. intentional feature-
        // detected fallbacks).
        if (config.wasmVariantCheck !== false) {
          try {
            // For "none", we need a runtime dir to read the universe of
            // exports from — re-resolve at the default variant just for
            // the check. resolveRuntime returns { skipInline: true } for
            // "none", so runtime.runtimeWasm is undefined here.
            const checkRuntimeDir = skipWasm
              ? (await resolveRuntime({ override: runtimeOverride, variant: "default", quiet: true })).runtimeWasm
              : runtime.runtimeWasm;
            const { warnings } = await checkVariant({
              runtimeDir: checkRuntimeDir,
              variant: config.wasmVariant ?? "default",
              variantExplicit: config.wasmVariantExplicit !== false,
              bundleSrc: src,
            });
            for (const w of warnings) {
              process.stderr.write(`[workbook] ${w}\n`);
            }
          } catch (e) {
            // Don't fail the build on a buggy analyzer.
            process.stderr.write(`[workbook] variant check skipped: ${e?.message ?? e}\n`);
          }
        }

        // Anchor on SLOT_PORTABLE if present (the transformIndexHtml
        // pre-pass put it there). Falls back to a </head> regex when
        // the source HTML never went through transformIndexHtml.
        // Closes core-bii: a user JS bundle that includes the
        // literal substring "</head>" (e.g. iframe srcdoc helpers)
        // can't trick us into landing 16 MB of base64 inside their
        // template literal because the slot is unique.
        src = injectIntoHead(src, wrapped, { consumeSlot: true });

        // One-workbook-one-iframe invariant — the pipeline must not
        // inject nested iframes. Runs on the post-injection HTML
        // before compression so a regression in any prior step is
        // caught here regardless of compress on/off.
        //
        // Stage-bearing workbooks legitimately emit ONE iframe from
        // the runtime's Playground.svelte mount. That iframe's source
        // lives in node_modules (excluded from the source walk), so
        // we hand the check a +1 allowance whenever a stage block is
        // declared. Plain workbooks (no stage) keep the strict invariant.
        const iframeAllowance = config.stage ? 1 : 0;
        await assertIframeInvariant({
          projectRoot: config.root,
          compiledHtml: src,
          allowance: iframeAllowance,
        });

        const uncompressedSize = Buffer.byteLength(src);
        let finalSrc = src;
        if (compressEnabled) {
          finalSrc = await brotliWrapHtml(src, { format: compressFormat });
        }
        // Rename Vite's `index.html` to `<slug>.html`. Workbook
        // identity travels in the file content (`<meta name="wb-permissions">`
        // / `<script id="wb-meta">`) and per-file OpenWith xattr,
        // not in the filename — so we drop the legacy `.html`
        // compound extension entirely as of 0.4.0. Files keep plain
        // `.html` so they open natively in any browser without our
        // app installed, and macOS Finder doesn't break them on
        // duplicate ("foo.html (1)" survives; "foo.workbook (1).html"
        // would have lost the recognized suffix). Files that come
        // in already named `<slug>.html` or with a custom name pass
        // through unchanged.
        const base = path.basename(file);
        const dir = path.dirname(file);
        let target;
        if (base === "index.html") {
          target = path.join(dir, `${config.slug}.html`);
        } else if (base.endsWith(".html")) {
          // Strip the legacy infix on rebuild so old projects
          // migrate cleanly without manual rename.
          target = file.replace(/\.workbook\.html$/, ".html");
        } else {
          // Custom filename (e.g. `foo.html`) — keep as-is.
          target = file;
        }
        await fs.writeFile(target, finalSrc);
        if (target !== file) await fs.rm(file);
        const finalBytes = Buffer.byteLength(finalSrc);
        const sizeMb = (finalBytes / 1024 / 1024).toFixed(2);
        if (compressEnabled) {
          const ratio = ((finalBytes / uncompressedSize) * 100).toFixed(1);
          const beforeMb = (uncompressedSize / 1024 / 1024).toFixed(2);
          process.stdout.write(
            `[workbook] inlined + ${compressFormat} → ${path.relative(process.cwd(), target)} (${sizeMb} MB, ${ratio}% of ${beforeMb} MB)\n`,
          );
        } else {
          process.stdout.write(
            `[workbook] inlined runtime → ${path.relative(process.cwd(), target)} (${sizeMb} MB)\n`,
          );
        }
      }
    },
  };
}

// `<script id="wb-capabilities">` — portable, self-describing list of
// tools the workbook exposes. The broker reads this on upload and
// populates `tools_json`; group MCP endpoints aggregate from it.
// JSON (not gzipped) because the lists are tiny (10s of tools max) and
// human-inspectable for debugging. `type` is non-script so browsers
// ignore it entirely — zero runtime cost, same trick as wb-source-bundle.
function buildCapabilitiesTag(config, tagOpen, tagEnd) {
  const tools = Array.isArray(config.tools) ? config.tools : [];
  if (tools.length === 0) return "";
  const payload = escapeForScript(JSON.stringify(tools));
  return (
    `${tagOpen} id="wb-capabilities"` +
    ` type="application/x-workbook-capabilities"` +
    ` data-version="1"` +
    ` data-tool-count="${tools.length}">` +
    payload +
    tagEnd
  );
}

// `<script id="wb-databases">` — portable list of browser-safe database
// slots the workbook needs. Names + kinds only; never credentials.
// Studio reads this at session start to render the slot-mapping UI;
// the standalone runtime reads it to know which config panel to show
// on first run. Suppressed when empty. Same non-script `type` trick
// as wb-capabilities — zero parse cost.
function buildDatabasesTag(config, tagOpen, tagEnd) {
  const dbs = Array.isArray(config.databases) ? config.databases : [];
  if (dbs.length === 0) return "";
  const payload = escapeForScript(JSON.stringify(dbs));
  return (
    `${tagOpen} id="wb-databases"` +
    ` type="application/x-workbook-databases"` +
    ` data-version="1"` +
    ` data-count="${dbs.length}">` +
    payload +
    tagEnd
  );
}

// `<script id="wb-host">` — optional host pointer. When present, the
// runtime reads it to brand the Studio-required takeover splash (and,
// later, the floater badge) for whatever team is shipping the
// workbook. Suppressed when no host is configured — runtime falls
// back to workbooks.sh defaults. wb-gnf.
function buildHostTag(config, tagOpen, tagEnd) {
  const host = config.host && typeof config.host === "object" ? config.host : null;
  if (!host || Object.keys(host).length === 0) return "";
  const payload = escapeForScript(JSON.stringify(host));
  return (
    `${tagOpen} id="wb-host"` +
    ` type="application/x-workbook-host"` +
    ` data-version="1">` +
    payload +
    tagEnd
  );
}

// `<script id="wb-databases-baked">` — inlined credentials for dev /
// public-RLS / private-self-use builds. Only emitted when the CLI
// resolves a credentials map (via `workbook dev`, `--bake-public-db`,
// or `--embed-private`). The dbBinding resolver in the runtime reads
// this AFTER postMessage + localStorage — so a Studio binding always
// overrides. Private builds also emit a console.warn so authors
// notice the artifact carries live secrets.
function buildDatabasesBakedTag(config, tagOpen, tagEnd) {
  const baked = config.databasesBaked && typeof config.databasesBaked === "object"
    ? config.databasesBaked
    : null;
  if (!baked || Object.keys(baked).length === 0) return "";
  const payload = escapeForScript(JSON.stringify(baked));
  const privateAttr = config.databasesBakedPrivate ? ` data-private="1"` : "";
  const warnScript = config.databasesBakedPrivate
    ? `\n${tagOpen}>console.warn("[workbook] this artifact contains baked database credentials (--embed-private). Do not redistribute.");${tagEnd}`
    : "";
  return (
    `${tagOpen} id="wb-databases-baked"` +
    ` type="application/x-workbook-databases-baked"` +
    ` data-version="1"` +
    privateAttr +
    `>` +
    payload +
    tagEnd +
    warnScript
  );
}

// `<script id="wb-params">` — playground-only tunables. Same emission
// pattern as wb-capabilities, but params are NEVER merged into the
// tools manifest (different conceptual surface: private-to-playground
// vs publicly-callable-MCP-tool). Suppressed when empty, matching the
// capabilities behavior.
function buildParamsTag(config, tagOpen, tagEnd) {
  const params = config.params && typeof config.params === "object" ? config.params : null;
  if (!params) return "";
  const names = Object.keys(params);
  if (names.length === 0) return "";
  const payload = escapeForScript(JSON.stringify(params));
  return (
    `${tagOpen} id="wb-params"` +
    ` type="application/x-workbook-params"` +
    ` data-version="1"` +
    ` data-param-count="${names.length}">` +
    payload +
    tagEnd
  );
}

function buildSpec(config) {
  return {
    manifest: {
      name: config.name,
      slug: config.slug,
      // Canonical rendering type: "document" | "notebook" | "spa" | "presentation".
      // Hosts use this to decide which chrome to wrap the workbook
      // in (or render it raw, in the SPA case).
      type: config.type ?? "spa",
      version: config.version,
      // Author identity + description for the social splash + the
      // in-workbook about toast. Both nullable (config-driven, not
      // required). When `author` is null the about toast is suppressed
      // at runtime — the field's presence is the toggle.
      author: config.author ?? null,
      description: config.description ?? null,
      // Group env vars the workbook is wired to consume via the
      // broker proxy. Surfaces in the chrome widget so recipients
      // see what credentials this workbook needs, and feeds the
      // workbook:connect SDK so it can pick the right env name by
      // URL host. See workbook.config.mjs > connect: { … }.
      connect: config.connect ?? {},
      // Tools the workbook advertises for MCP/CLI invocation. The
      // broker indexer reads this surface and produces one Vectorize
      // row per tool so agents can search "find a workbook that
      // exposes a forecast tool" and get a direct hit. No new author
      // surface — declared in workbook.config.mjs > tools: {}.
      tools: config.tools ?? [],
      // Playground-only tunables. Surfaced in the effects panel,
      // distinct from tools — never MCP-callable. Two fields, two
      // emissions: see also <script id="wb-params">.
      params: config.params ?? {},
      env: config.env ?? {},
      runtimeFeatures: config.runtimeFeatures ?? [],
      // Browser-safe database slots the workbook needs (Supabase /
      // Convex / Turso). Names + kinds only — credentials are wired
      // up by Studio or the standalone runtime at session start. The
      // portable manifest at <script id="wb-databases"> carries the
      // same payload; this duplicate in the spec keeps the indexer +
      // hosted viewer one read away from the slot list.
      databases: config.databases ?? [],
      // Stage primitive (canonical) — runtime's mountStage reads this
      // to load the wrapped workbook and lay out side panels. Present
      // only when the spa workbook declares `stage: { wraps, panels }`.
      // `playground` alias is written too so artifacts built today still
      // resolve under older runtime versions that read manifest.playground.
      stage: config.stage ?? null,
      playground: config.stage ?? null,
    },
    cells: [],
    inputs: {},
  };
}

async function collectHtml(dir) {
  const out = [];
  async function walk(d) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".html")) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

// Build <link rel="icon"> tags for the workbook. Always inlines as a
// data: URL so the saved .html ships with the icon and a
// file:// open shows the right glyph in the browser tab. The
// ".html → OS file icon" association is a separate concern
// that needs platform-level registration; see core-7fw.1.
async function buildIconLinks(config) {
  const icons = config.icons ?? [{ src: DEFAULT_ICON_PATH, _isDefault: true }];
  const tags = [];
  for (const icon of icons) {
    const abs = icon._isDefault
      ? icon.src
      : path.resolve(config.root, icon.src);
    let bytes;
    try { bytes = await fs.readFile(abs); }
    catch (e) {
      process.stderr.write(`[workbook] icon not readable: ${abs}\n`);
      continue;
    }
    const ext = path.extname(abs).toLowerCase().slice(1);
    const mime = icon.type ?? extToMime(ext);
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    const sizes = icon.sizes ? ` sizes="${escapeAttr(icon.sizes)}"` : "";
    const typeAttr = ` type="${escapeAttr(mime)}"`;
    tags.push(`<link rel="icon"${typeAttr}${sizes} href="${dataUrl}">`);
  }
  return tags.join("\n");
}

function extToMime(ext) {
  switch (ext) {
    case "svg":  return "image/svg+xml";
    case "png":  return "image/png";
    case "ico":  return "image/x-icon";
    case "gif":  return "image/gif";
    case "webp": return "image/webp";
    case "jpg":  case "jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
