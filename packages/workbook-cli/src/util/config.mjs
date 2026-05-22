// Workbook config loader. Looks for workbook.config.{js,mjs} in the
// project root, validates required fields, applies defaults.
//
// A minimal config:
//
//   export default {
//     name: "my workbook",
//     slug: "my-workbook",
//     entry: "src/index.html",
//   };
//
// Extended:
//
//   export default {
//     name: "my workbook",
//     slug: "my-workbook",
//     entry: "src/index.html",
//     env: {
//       OPENROUTER_API_KEY: { required: true, secret: true, prompt: "sk-or-…" },
//     },
//     runtimeFeatures: ["polars", "rhai", "charts"],  // hint only, not enforced
//     vite: { /* extra Vite config merged in */ },
//   };

import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CANDIDATES = ["workbook.config.mjs", "workbook.config.js"];

export async function loadConfig(projectDir) {
  const root = path.resolve(projectDir);
  let configPath = null;
  for (const c of CANDIDATES) {
    const p = path.join(root, c);
    try { await fs.access(p); configPath = p; break; } catch {}
  }
  if (!configPath) {
    throw new Error(
      `no workbook.config.{js,mjs} found in ${root}.\n` +
      `Create one with at minimum: { name, slug, entry }.`,
    );
  }

  const mod = await import(pathToFileURL(configPath).href);
  const cfg = mod.default ?? mod;
  if (!cfg || typeof cfg !== "object") {
    throw new Error(`${configPath} did not export a config object (use 'export default {...}')`);
  }

  if (!cfg.slug || typeof cfg.slug !== "string") {
    throw new Error(`workbook.config: 'slug' is required (string, kebab-case)`);
  }
  if (!cfg.entry || typeof cfg.entry !== "string") {
    throw new Error(`workbook.config: 'entry' is required (path to entry HTML file, relative to project root)`);
  }
  const entryAbs = path.resolve(root, cfg.entry);
  try { await fs.access(entryAbs); } catch {
    throw new Error(`workbook.config: entry not found: ${cfg.entry} (resolved to ${entryAbs})`);
  }

  // Workbook type — canonical rendering profile. Must be one of:
  //   "document" — sdoc-style read-mostly artifact (prose + auto-rendered blocks)
  //   "notebook" — Jupyter-style linear runner with cells + reactive DAG
  //   "spa"      — full canvas app (chat-app, svelte-app); author renders custom UI
  //   "presentation" — fixed-ratio slide deck with interactive HTML slides
  //   "agent"    — pi-coding-agent definition. The artifact's body is a
  //                renderable preview card; the actual agent runs server-side
  //                in an E2B sandbox, parameterised by the embedded wb-agent
  //                JSON (model, systemPrompt, tools, extensions).
  // Required — every workbook is a specific shape. No fallback.
  const VALID_TYPES = new Set([
    "document",
    "notebook",
    "spa",
    "presentation",
    "agent",
    "playground",
  ]);
  if (cfg.type === undefined || cfg.type === null) {
    throw new Error(
      `workbook.config: 'type' is required. Pick one: ${[...VALID_TYPES].join(", ")}.`,
    );
  }
  const type = cfg.type;
  if (!VALID_TYPES.has(type)) {
    throw new Error(`workbook.config: 'type' must be one of: ${[...VALID_TYPES].join(", ")} (got '${type}')`);
  }

  // Agent block — required when type === "agent", forbidden otherwise.
  let agent = null;
  if (type === "agent") {
    const a = cfg.agent;
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      throw new Error(
        "workbook.config: type:'agent' requires an 'agent' object with { model, systemPrompt, tools, ... }",
      );
    }
    const VALID_PROVIDERS = new Set([
      "openrouter",
      "anthropic",
      "openai",
      "google",
      "litellm",
    ]);
    const provider = a.provider ?? "openrouter";
    if (typeof provider !== "string" || !VALID_PROVIDERS.has(provider)) {
      throw new Error(
        `workbook.config: agent.provider must be one of ${[...VALID_PROVIDERS].join(", ")} (got '${provider}')`,
      );
    }
    if (typeof a.model !== "string" || a.model.length === 0) {
      throw new Error("workbook.config: agent.model is required (string)");
    }
    if (typeof a.systemPrompt !== "string" || a.systemPrompt.length === 0) {
      throw new Error(
        "workbook.config: agent.systemPrompt is required (non-empty string)",
      );
    }
    if (!Array.isArray(a.tools) || a.tools.some((t) => typeof t !== "string")) {
      throw new Error(
        "workbook.config: agent.tools must be an array of tool names (string[])",
      );
    }
    if (a.extensions !== undefined && !Array.isArray(a.extensions)) {
      throw new Error("workbook.config: agent.extensions must be an array of strings");
    }
    if (
      a.permissions !== undefined &&
      (typeof a.permissions !== "object" || Array.isArray(a.permissions))
    ) {
      throw new Error("workbook.config: agent.permissions must be an object");
    }
    if (
      a.defaultEnv !== undefined &&
      (typeof a.defaultEnv !== "object" || Array.isArray(a.defaultEnv))
    ) {
      throw new Error("workbook.config: agent.defaultEnv must be an object");
    }
    const schedules = extractAgentScheduleDeclarations(a.schedules);
    const runtimeTargets = extractAgentRuntimeTargets(a.runtimeTargets ?? a.runtimeTarget);
    const capabilities = extractAgentCapabilities(a.capabilities);
    // agent.components — map of name → relative path to a JS file.
    // The JS file's default export is (target, props, emit) => unmount.
    // CLI bundles each with esbuild + IIFE-wraps it; the agent's
    // artifact ships them base64+gzip in <script id="wb-components">.
    // Hackable substrate — plain JS, no framework runtime baked in.
    let components = null;
    if (a.components !== undefined) {
      if (typeof a.components !== "object" || Array.isArray(a.components)) {
        throw new Error("workbook.config: agent.components must be an object map of name → path");
      }
      components = {};
      for (const [name, p] of Object.entries(a.components)) {
        if (!/^[a-zA-Z][\w-]*$/.test(name)) {
          throw new Error(`workbook.config: agent.components key '${name}' must be a JS identifier`);
        }
        if (typeof p !== "string") {
          throw new Error(`workbook.config: agent.components.${name} must be a string path`);
        }
        components[name] = p;
      }
    }
    // agent.skills — map of key → { description, docs } (path to markdown).
    let skills = null;
    if (a.skills !== undefined) {
      if (typeof a.skills !== "object" || Array.isArray(a.skills)) {
        throw new Error("workbook.config: agent.skills must be an object map");
      }
      skills = {};
      for (const [key, decl] of Object.entries(a.skills)) {
        if (!/^[a-z][a-z0-9-]*$/.test(key)) {
          throw new Error(`workbook.config: agent.skills.${key} key must be kebab-case`);
        }
        if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
          throw new Error(`workbook.config: agent.skills.${key} must be { description, docs }`);
        }
        const description = decl.description;
        const docs = decl.docs;
        if (typeof description !== "string" || !description) {
          throw new Error(`workbook.config: agent.skills.${key}.description is required`);
        }
        if (typeof docs !== "string" || !docs) {
          throw new Error(`workbook.config: agent.skills.${key}.docs (markdown path) is required`);
        }
        skills[key] = { description, docs };
      }
    }
    agent = {
      provider,
      model: a.model,
      systemPrompt: a.systemPrompt,
      tagline:
        typeof a.tagline === "string" && a.tagline.length > 0
          ? a.tagline
          : null,
      icon: typeof a.icon === "string" && a.icon.length > 0 ? a.icon : null,
      tools: a.tools,
      extensions: a.extensions ?? [],
      components,
      skills,
      schedules,
      runtimeTargets,
      capabilities,
      permissions: a.permissions ?? null,
      defaultEnv: a.defaultEnv ?? null,
    };
  } else if (cfg.agent !== undefined) {
    throw new Error(
      `workbook.config: 'agent' block is only valid when type:'agent' (current type is '${type}')`,
    );
  }

  // shape-drift-ok: 'playground' below is the legacy type accepted for
  // back-compat with workbook.config.mjs files that haven't migrated to
  // type:"spa" + stage:{} yet. New code writes 'stage'.

  // Stage block — canonical name for the iframe-wrapping primitive a
  // workbook can mount alongside an embedded agent. Lives on a
  // type:"spa" workbook (formerly its own type:"playground"; the old
  // key is still accepted as back-compat when type:"playground").
  // A stage wraps another workbook in a sandboxed iframe with
  // toggleable side panels (effects / chat) and a bottom terminal.
  const VALID_PANEL_CONTENT = new Set(["effects", "chat"]);
  let stage = null;
  const stageRawCanonical = type === "spa" ? cfg.stage : undefined;
  const stageRawLegacy = type === "playground" ? cfg.playground : undefined;
  const stageRaw = stageRawCanonical ?? stageRawLegacy;
  const stageBlockName = stageRawCanonical ? "stage" : "playground";
  if (stageRaw !== undefined) {
    if (!stageRaw || typeof stageRaw !== "object" || Array.isArray(stageRaw)) {
      throw new Error(
        `workbook.config: '${stageBlockName}' must be an object with { wraps, panels? }`,
      );
    }
    if (typeof stageRaw.wraps !== "string" || !stageRaw.wraps.trim()) {
      throw new Error(
        `workbook.config: ${stageBlockName}.wraps is required — URL or relative path to the workbook being wrapped`,
      );
    }
    const wrapsValue = stageRaw.wraps.trim();
    if (!/^(https?:\/\/|\/|\.\/|\.\.\/)/.test(wrapsValue)) {
      throw new Error(
        `workbook.config: ${stageBlockName}.wraps must be a URL or relative path (got '${wrapsValue}'). ` +
        `Use 'http(s)://...', '/absolute/path', './sibling.html', or '../other-project/dist/x.html'. ` +
        `Bare slugs aren't supported in v1 — slug→hosted resolution is pending.`,
      );
    }
    let panels = { left: null, right: null, bottom: null };
    if (stageRaw.panels !== undefined) {
      if (typeof stageRaw.panels !== "object" || Array.isArray(stageRaw.panels)) {
        throw new Error(`workbook.config: ${stageBlockName}.panels must be an object`);
      }
      for (const side of ["left", "right"]) {
        const v = stageRaw.panels[side];
        if (v != null && (typeof v !== "string" || !VALID_PANEL_CONTENT.has(v))) {
          throw new Error(
            `workbook.config: ${stageBlockName}.panels.${side} must be one of ${[...VALID_PANEL_CONTENT].join(", ")} or null (got '${v}')`,
          );
        }
        panels[side] = v ?? null;
      }
      const b = stageRaw.panels.bottom;
      if (b != null && b !== "terminal") {
        throw new Error(
          `workbook.config: ${stageBlockName}.panels.bottom must be 'terminal' or null (got '${b}')`,
        );
      }
      panels.bottom = b ?? null;
    }
    stage = { wraps: wrapsValue, panels };
  } else if (cfg.stage !== undefined) {
    throw new Error(
      `workbook.config: 'stage' block requires type:'spa' (current type is '${type}')`,
    );
  } else if (cfg.playground !== undefined) {
    throw new Error(
      `workbook.config: 'playground' block is only valid when type:'playground' (current type is '${type}'). New code should use type:'spa' with a 'stage' block.`,
    );
  }

  // Params — playground-only tunables (colors, easing, ratios, named
  // numbers) surfaced in the effects panel. Same JSON Schema property
  // shape as tools[i].input_schema.properties, but NEVER merged into
  // the tools manifest or the broker's tools_json column. Allowed on
  // any workbook type so a wrapped SPA can declare params even if it
  // isn't a playground itself — the playground's effects panel reads
  // params from the wrapped artifact.
  const params = extractParamDeclarations(cfg.params);

  // Icons — accept short form (single string path) or long form (array of
  // { src, sizes?, type? }). Normalize to the long form. If neither is
  // provided, the build plugin substitutes a default workbook glyph so
  // every saved .html has a recognizable browser-tab icon.
  let icons = null;
  if (typeof cfg.icon === "string" && cfg.icon) {
    icons = [{ src: cfg.icon }];
  } else if (Array.isArray(cfg.icons)) {
    icons = cfg.icons.map((entry, i) => {
      if (typeof entry === "string") return { src: entry };
      if (entry && typeof entry === "object" && typeof entry.src === "string") {
        return { src: entry.src, sizes: entry.sizes, type: entry.type };
      }
      throw new Error(
        `workbook.config: icons[${i}] must be a string path or { src, sizes?, type? }`,
      );
    });
  }
  if (icons) {
    for (const icon of icons) {
      const abs = path.resolve(root, icon.src);
      try { await fs.access(abs); }
      catch { throw new Error(`workbook.config: icon not found: ${icon.src} (resolved to ${abs})`); }
    }
  }

  // Encryption — optional. Configures the CLI's --encrypt build stage.
  // Build flags override any of these. Shape:
  //
  //   encrypt: {
  //     method: "passphrase",        // v1 supports passphrase only
  //     scope: "full",               // v1 ships "full" (user mode in P3.x)
  //     passwordEnv: "WORKBOOK_PASSWORD",  // env var to read at build
  //     devPassword: "dev-fixture",  // used by `workbook dev --encrypt`
  //   }
  //
  // Validation here catches typos / wrong types early; the actual
  // encrypt stage in build.mjs handles missing env vars at runtime.
  const VALID_METHODS = new Set(["passphrase"]); // multi-unlock in P3.x
  const VALID_SCOPES = new Set(["full"]);        // user-scope in P3.x
  let encrypt = null;
  if (cfg.encrypt !== undefined && cfg.encrypt !== null) {
    if (typeof cfg.encrypt !== "object" || Array.isArray(cfg.encrypt)) {
      throw new Error(
        `workbook.config: 'encrypt' must be an object (or omitted)`,
      );
    }
    const method = cfg.encrypt.method ?? "passphrase";
    if (!VALID_METHODS.has(method)) {
      throw new Error(
        `workbook.config: encrypt.method must be one of: ${[...VALID_METHODS].join(", ")} (got '${method}')`,
      );
    }
    const scope = cfg.encrypt.scope ?? "full";
    if (!VALID_SCOPES.has(scope)) {
      throw new Error(
        `workbook.config: encrypt.scope must be one of: ${[...VALID_SCOPES].join(", ")} (got '${scope}')`,
      );
    }
    encrypt = {
      method,
      scope,
      passwordEnv: cfg.encrypt.passwordEnv ?? "WORKBOOK_PASSWORD",
      devPassword: cfg.encrypt.devPassword ?? null,
    };
  }

  // Logos — declarative list of brand SVGs the workbook references.
  // Used heavily by presentation-shape workbooks (customer walls,
  // integration grids, etc.) but allowed on any workbook type. At
  // build time the CLI fetches each SVG from its source registry and
  // inlines it as base64 in a `<script id="wb-logos">` tag. Runtime
  // SDK exposes `wb.logos.<as>.dataUrl` (or .svg). Authors never write
  // a network call for a logo — keeps the artifact portable + offline
  // on stage.
  const logos = extractLogoDeclarations(cfg.logos);

  // Source bundle — embed a gzipped JSON snapshot of the project source
  // inside the compiled .html so recipients can `workbook unbundle`.
  // On by default for unencrypted builds (W1.3 of the workbooks pivot
  // 2026-05-04). Authors with proprietary trees opt out via
  // `bundle: { enabled: false }`. `additionalIgnore` accepts gitignore-
  // lite patterns; `includeGit: true` ships the .git/ directory too.
  let bundle = { enabled: true, includeGit: false, additionalIgnore: [] };
  if (cfg.bundle !== undefined && cfg.bundle !== null) {
    if (cfg.bundle === false) {
      bundle = { enabled: false, includeGit: false, additionalIgnore: [] };
    } else if (typeof cfg.bundle === "object" && !Array.isArray(cfg.bundle)) {
      bundle = {
        enabled: cfg.bundle.enabled !== false,
        includeGit: cfg.bundle.includeGit === true,
        additionalIgnore: Array.isArray(cfg.bundle.additionalIgnore)
          ? cfg.bundle.additionalIgnore.slice()
          : [],
      };
      if (
        !bundle.additionalIgnore.every((p) => typeof p === "string" && p.length > 0)
      ) {
        throw new Error(
          "workbook.config: bundle.additionalIgnore must be an array of non-empty strings",
        );
      }
    } else {
      throw new Error(
        "workbook.config: 'bundle' must be a boolean or " +
          "{ enabled?, includeGit?, additionalIgnore? }",
      );
    }
  }

  // Wasm variant — picks which pre-built slice of runtime-wasm to
  // inline. SPA-shape workbooks save megabytes by opting into a
  // smaller variant; data-app workbooks (sql/ML) need the default.
  // See packages/workbook-cli/src/util/runtime.mjs `variantToPkgDir`.
  const VALID_WASM_VARIANTS = new Set(["default", "minimal", "app", "none"]);
  const wasmVariant = cfg.wasmVariant ?? "default";
  if (!VALID_WASM_VARIANTS.has(wasmVariant)) {
    throw new Error(
      `workbook.config: 'wasmVariant' must be one of: ${[...VALID_WASM_VARIANTS].join(", ")} (got '${wasmVariant}')`,
    );
  }
  // Variant-coverage check is on by default — warns at build time
  // when the chosen variant doesn't ship a symbol the bundle
  // references. Workbooks that intentionally feature-detect against
  // optional surfaces (e.g. `if (wasm.arrowEncodeJsonRows) { ... }`)
  // can opt out with `wasmVariantCheck: false` to silence.
  const wasmVariantCheck = cfg.wasmVariantCheck !== false;

  return {
    root,
    configPath,
    name: cfg.name ?? cfg.slug,
    slug: cfg.slug,
    // Author + description surface on the hosted viewer's trust prompt
    // (workbooks.sh/w/<id>). Both optional; if absent the splash falls
    // back to slug-only display. Author is per-workbook so the same
    // account can publish under different display names.
    author: typeof cfg.author === "string" ? cfg.author.trim() : null,
    description:
      typeof cfg.description === "string" ? cfg.description.trim() : null,
    // Group env vars the workbook uses at runtime, e.g.
    //   connect: {
    //     OPENAI_KEY: { inject: "bearer", domains: ["api.openai.com"] }
    //   }
    // Distinct from the legacy `env` field below (daemon-era runtime
    // prompts). The workbook code calls
    //   wbFetch(url, { env: "OPENAI_KEY", ... })
    // and the broker proxy splices the group's stored value into the
    // outbound header IF the URL host matches the var's domains.
    // Plaintext never reaches the workbook.
    connect: extractConnectDeclarations(cfg.connect),
    // Declarative list of integration toolkits the workbook needs at
    // runtime (e.g. ["gmail", "github"]). Recipients are prompted to
    // connect each via Studio → Integrations before the hosted viewer
    // executes any tool calls. Authors discover what's available with
    // `workbook connections list`. For agent workbooks, these can also
    // be expressed via tools: ["composio:<toolkit>"]; the integrations
    // array is the canonical surface for non-agent workbooks.
    integrations: extractIntegrationsList(cfg.integrations),
    // Tools the workbook advertises to MCP clients. Same shape as
    // an MCP tool definition — name, description, input_schema —
    // baked into manifest.tools[] at build time. Extracted here,
    // indexed by the broker, surfaced to agents via the workbooks
    // MCP server. No separate authoring file: declare them in
    // workbook.config.mjs > tools: { fn_name: { description, input } }
    // Public manifest entries (no handler paths — those stay internal).
    tools: extractToolDeclarations(cfg.tools).manifest,
    // Build-time only: handler path per tool. Used by the tools
    // Worker bundler at publish; not baked into the artifact.
    _toolHandlers: extractToolDeclarations(cfg.tools).handlers,
    // Browser-safe database slots the workbook requires. Authors name
    // each slot and pick a `kind` (supabase | convex | turso); Studio
    // or the standalone runtime maps the slot to a stored connection
    // at session start. Manifest carries slot names + kinds only —
    // credentials are wired up at runtime, never baked into the artifact.
    databases: extractDatabaseDeclarations(cfg.databases),
    // Optional host pointer. Lets a workbook tell its runtime which
    // Studio to redirect recipients to when the file is opened
    // outside a host (Studio-required takeover splash, floater
    // badge, "open in Studio" CTAs). Defaults to workbooks.sh.
    // Universal format; per-team studios populate their own branding.
    host: extractHostPointer(cfg.host),
    // Optional WASM strategy. Default "bundle" preserves single-file
    // portability — every runtime asset embeds in the .html. Authors
    // who want bandwidth savings (and accept the portability tradeoff)
    // opt into "reference": the artifact ships a wb-wasm-refs metadata
    // tag pointing at a CDN base URL, runtime fetches at boot.
    //   wasm: { strategy: "bundle" }  (default; preserves portability)
    //   wasm: { strategy: "reference",
    //           cdnBaseUrl: "https://cdn.jsdelivr.net/npm/@work.books/runtime-wasm@latest" }
    // wb-e19.10.
    wasm: extractWasmStrategy(cfg.wasm),
    // floater: false in workbook.config.mjs suppresses the runtime
    // floater module's automatic surface (the bottom-corner "needs
    // attention" pill). Connection-error callsites still call
    // floater.add() — those become no-ops when disabled. Use for
    // ultra-minimal embeds where any chrome is unwelcome.
    floater: cfg.floater === false ? false : true,
    // Playground-only tunables, parallel to tools but kept strictly
    // separate. Surfaces in the effects panel via the wb-params script
    // tag at build time; never merged into tools_json.
    params,
    // Optional distribution wrappers. Recipients consume the tools[]
    // surface through one of these packages. No new capability — the
    // HTTP /call surface always works regardless; package config
    // changes how the surface gets advertised to friendly clients.
    package: extractPackageDeclarations(cfg.package),
    type,
    agent,
    // Canonical key (was: playground). Build plugin and runtime read
    // `manifest.stage` going forward; the `playground` alias below is
    // kept until back-compat readers are confirmed gone.
    stage,
    playground: stage,
    version: cfg.version ?? "0.1",
    entry: cfg.entry,
    entryAbs,
    env: cfg.env ?? {},
    icons,                      // null means "use the default workbook glyph"
    runtimeFeatures: cfg.runtimeFeatures ?? [],
    wasmVariant,
    wasmVariantExplicit: cfg.wasmVariant !== undefined,
    wasmVariantCheck,
    vite: cfg.vite ?? {},
    // Inline assets unless explicitly disabled; --no-wasm flag flips this.
    inlineRuntime: cfg.inlineRuntime ?? true,
    encrypt,                    // null when not configured
    bundle,                     // source-bundle settings; default enabled
    logos,                      // [] when none; resolved + inlined at build
    // Compression of the finalized HTML (gzip or brotli sandwich).
    // Default true; authors set false on wrapped workbooks whose
    // compiled HTML must remain readable for embedWrapped to verify
    // the wb-meta marker. Accepts true | false | "gzip" | "br".
    compress: cfg.compress,
    // capability declarations resolved at build/publish time via Studio capability resolver (wb-yufs.4 Phase 1: CLI commands only; runtime embed in Phase 2)
    capabilities: extractCapabilityDeclarations(cfg.capabilities),
    // Theme lock for the rendered color-scheme. "system" (default)
    // follows OS prefers-color-scheme; "light" / "dark" lock the
    // theme regardless. The runtime baseline ships matching CSS
    // tokens (--color-page/surface/fg/...) so authors using
    // var(--color-...) get system-aware dark mode for free. wb-yufs.1.
    theme: cfg.theme === "light" || cfg.theme === "dark" ? cfg.theme : "system",
  };
}

const VALID_CAPABILITY_SCOPES = new Set(["user", "group", "org"]);

function extractCapabilityDeclarations(raw) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "workbook.config: 'capabilities' must be an object keyed by family-prefixed slug",
    );
  }
  const out = {};
  for (const [slug, decl] of Object.entries(raw)) {
    if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
      throw new Error(`workbook.config: capabilities[${JSON.stringify(slug)}] must be an object`);
    }
    if (!VALID_CAPABILITY_SCOPES.has(decl.scope)) {
      throw new Error(
        `workbook.config: capabilities[${JSON.stringify(slug)}].scope must be one of ${[...VALID_CAPABILITY_SCOPES].join(", ")}`,
      );
    }
    out[slug] = { ...decl };
  }
  return out;
}

const VALID_LOGO_SOURCES = new Set([
  "auto",
  "lobehub",
  "svgl",
  "iconify-logos",
  "iconify-cib",
  "devicon",
  "simple",
  "pack",
]);

/** Validate + normalize the `logos` block from workbook.config.mjs.
 *
 *   logos: [
 *     { id: "openai" },                          // auto-pick (recommended)
 *     { id: "stripe", as: "stripe" },            // auto-pick with explicit `as`
 *     { id: "openai", source: "lobehub" },       // force a specific source
 *     { id: "fda",    source: "pack" },          // force curated pack
 *   ]
 *
 *  `source` defaults to "auto" — the CLI fans out across all known
 *  sources (lobehub → svgl → iconify-logos → iconify-cib → devicon →
 *  simple → pack) and uses the first that returns an SVG.
 *
 *  `as` defaults to `id`. Names appear at runtime as
 *  `getLogos().<as>.dataUrl`. Authors with brand-id collisions across
 *  sources use `as` to disambiguate. */
function extractLogoDeclarations(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(
      "workbook.config: 'logos' must be an array of { id, source?, as? } entries",
    );
  }
  const out = [];
  const seenAs = new Set();
  for (let i = 0; i < raw.length; i++) {
    const decl = raw[i];
    if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
      throw new Error(`workbook.config: logos[${i}] must be an object`);
    }
    if (typeof decl.id !== "string" || !decl.id.trim()) {
      throw new Error(`workbook.config: logos[${i}].id is required (string)`);
    }
    const source = decl.source === undefined || decl.source === null
      ? "auto"
      : decl.source;
    if (typeof source !== "string" || !VALID_LOGO_SOURCES.has(source)) {
      throw new Error(
        `workbook.config: logos[${i}].source must be one of ${[...VALID_LOGO_SOURCES].join(", ")} (got '${decl.source}'). ` +
        `Omit the field to use 'auto' (recommended).`,
      );
    }
    const as = typeof decl.as === "string" && decl.as.trim() ? decl.as.trim() : decl.id.trim();
    if (!/^[a-zA-Z_][\w-]*$/.test(as)) {
      throw new Error(
        `workbook.config: logos[${i}].as ${JSON.stringify(as)} must be a JS identifier-ish [a-zA-Z_][\\w-]*`,
      );
    }
    if (seenAs.has(as)) {
      throw new Error(`workbook.config: logos[${i}].as '${as}' duplicates an earlier entry`);
    }
    seenAs.add(as);
    out.push({ id: decl.id.trim(), source, as });
  }
  return out;
}

function extractAgentScheduleDeclarations(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("workbook.config: agent.schedules must be an array");
  }
  return raw.map((decl, i) => {
    if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
      throw new Error(`workbook.config: agent.schedules[${i}] must be an object`);
    }
    const scheduleType = decl.scheduleType ?? decl.type;
    if (scheduleType !== "interval" && scheduleType !== "daily") {
      throw new Error(
        `workbook.config: agent.schedules[${i}].scheduleType must be "interval" or "daily"`,
      );
    }
    if (typeof decl.prompt !== "string" || decl.prompt.trim().length === 0) {
      throw new Error(`workbook.config: agent.schedules[${i}].prompt is required`);
    }
    const out = {
      title: typeof decl.title === "string" ? decl.title.slice(0, 120) : null,
      prompt: decl.prompt.slice(0, 5000),
      enabled: decl.enabled === true,
      scheduleType,
      timezone: typeof decl.timezone === "string" && decl.timezone ? decl.timezone : "UTC",
    };
    if (typeof decl.model === "string" && decl.model) out.model = decl.model;
    if (typeof decl.runtimeTarget === "string") {
      if (!VALID_AGENT_RUNTIME_TARGETS.has(decl.runtimeTarget) && decl.runtimeTarget !== "auto") {
        throw new Error(
          `workbook.config: agent.schedules[${i}].runtimeTarget must be "auto" or one of ${[...VALID_AGENT_RUNTIME_TARGETS].join(", ")}`,
        );
      }
      out.runtimeTarget = decl.runtimeTarget;
    }
    if (scheduleType === "interval") {
      const minutes = Number(decl.intervalMinutes ?? decl.everyMinutes);
      if (!Number.isFinite(minutes) || minutes < 5) {
        throw new Error(
          `workbook.config: agent.schedules[${i}].intervalMinutes must be at least 5`,
        );
      }
      out.intervalMinutes = Math.floor(minutes);
    } else {
      const minutes = Number(decl.timeOfDayMinutes);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 24 * 60) {
        throw new Error(
          `workbook.config: agent.schedules[${i}].timeOfDayMinutes must be 0..1439`,
        );
      }
      out.timeOfDayMinutes = Math.floor(minutes);
    }
    return out;
  });
}

const VALID_AGENT_RUNTIME_TARGETS = new Set([
  "browser-js",
  "worker-js",
  "workflow-js",
  "browser-run",
  "linux-sandbox",
]);

const VALID_AGENT_CAPABILITIES = new Set([
  "bash-vfs",
  "network",
  "dom",
  "node",
  "python-wasm",
  "python-native",
  "sqlite",
  "filesystem-read",
  "filesystem-write",
  "git",
  "native-binaries",
  "long-running",
]);

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function extractAgentRuntimeTargets(raw) {
  if (raw == null) return ["linux-sandbox"];
  const values = Array.isArray(raw) ? raw : [raw];
  if (values.length === 0) {
    throw new Error("workbook.config: agent.runtimeTargets must not be empty");
  }
  for (const value of values) {
    if (typeof value !== "string" || !VALID_AGENT_RUNTIME_TARGETS.has(value)) {
      throw new Error(
        `workbook.config: agent.runtimeTargets entries must be one of ${[...VALID_AGENT_RUNTIME_TARGETS].join(", ")}`,
      );
    }
  }
  return uniqueStrings(values);
}

function extractAgentCapabilities(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("workbook.config: agent.capabilities must be an array");
  }
  for (const value of raw) {
    if (typeof value !== "string" || !VALID_AGENT_CAPABILITIES.has(value)) {
      throw new Error(
        `workbook.config: agent.capabilities entries must be one of ${[...VALID_AGENT_CAPABILITIES].join(", ")}`,
      );
    }
  }
  return uniqueStrings(raw);
}

/**
 * Validate + normalize the `connect` block from workbook.config.mjs.
 * Returns a plain object that the build pipeline bakes into the
 * workbook manifest as `manifest.connect`.
 *
 * Shape:
 *   connect: {
 *     OPENAI_KEY: { inject: "bearer", domains: ["api.openai.com"] },
 *     STRIPE_KEY: { inject: "header:Stripe-Account", template: "{value}", domains: ["api.stripe.com"] },
 *   }
 *
 * Naming: keys are UPPER_SNAKE env-var-style identifiers, 1-64 chars.
 * Workbook code refers to them by name via `env: "OPENAI_KEY"` on
 * each proxy call.
 *
 * Inject directives:
 *   - "bearer"               → Authorization: Bearer <value> (or template)
 *   - "header:HeaderName"    → set that header to the template
 *   - "query:paramName"      → append/set query param
 *
 * Domains: array of host patterns. Exact match or "*.example.com"
 * for any subdomain. Empty → broker will reject every call.
 */
/**
 * Validate + normalize the `tools` block from workbook.config.mjs.
 *
 * Shape:
 *   tools: {
 *     forecast_revenue: {
 *       description: "Project Q3 revenue from Q1/Q2 actuals.",
 *       input_schema: { ... JSON Schema ... },
 *       output_schema: { ... JSON Schema ... },
 *     },
 *   }
 *
 * Tool names: lowercase + underscore (matches MCP tool naming
 * conventions). 1-64 chars. The author declares one entry per
 * function the workbook exposes for invocation; the runtime / agent
 * client looks them up by name.
 *
 * The tool's IMPLEMENTATION lives in workbook code — same author
 * writes the function and exports it; the build pipeline maps the
 * name from this declaration to an entry in the artifact. Today
 * we just bake the advertisement; #82 wires invocation.
 */
/** Returns { manifest, handlers } —
 *  - `manifest` is the public list baked into <script id="workbook-spec">
 *    (no handler paths — those are internal build-time data).
 *  - `handlers` maps tool name → file path so the build can locate
 *    the implementation and bundle it into the tools Worker. */
function extractToolDeclarations(raw) {
  const out = { manifest: [], handlers: {} };
  if (raw == null) return out;

  // Accept both shapes:
  //   tools: { lookup: { description, input_schema, handler } }
  //   tools: [ { name: "lookup", description, input_schema, handler } ]
  // Array form matches MCP's own tool-list shape and the wb-1ru spec.
  // Object form is the legacy keyed-by-name form; we keep it for
  // round-trip with workbooks already in the wild.
  let entries;
  if (Array.isArray(raw)) {
    entries = raw.map((decl, i) => {
      if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
        throw new Error(
          `workbook.config: tools[${i}] must be an object with { name, description?, input_schema?, handler? }`,
        );
      }
      if (typeof decl.name !== "string") {
        throw new Error(`workbook.config: tools[${i}].name is required (string)`);
      }
      return [decl.name, decl];
    });
  } else if (typeof raw === "object") {
    entries = Object.entries(raw);
  } else {
    throw new Error(
      "workbook.config: 'tools' must be an array of tool objects or an object keyed by tool name",
    );
  }

  for (const [name, decl] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
      throw new Error(
        `workbook.config: tool name ${JSON.stringify(name)} must be snake_case [a-z][a-z0-9_]{0,63}`,
      );
    }
    if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
      throw new Error(`workbook.config: tools[${name}] must be an object`);
    }
    const description =
      typeof decl.description === "string" ? decl.description.trim() : "";
    const input_schema = decl.input_schema ?? decl.input ?? null;
    const output_schema = decl.output_schema ?? decl.output ?? null;
    const handler = typeof decl.handler === "string" ? decl.handler : null;
    const runtime = decl.runtime === "browser" ? "browser" : "worker";

    out.manifest.push({
      name,
      ...(description ? { description } : {}),
      ...(input_schema ? { input_schema } : {}),
      ...(output_schema ? { output_schema } : {}),
      runtime,
    });
    if (handler && runtime === "worker") {
      out.handlers[name] = handler;
    }
  }
  return out;
}

const VALID_DATABASE_KINDS = new Set(["supabase", "convex", "turso"]);

/**
 * Validate + normalize the `databases` block from workbook.config.mjs.
 *
 *   databases: {
 *     main:  { kind: "supabase", access: "rls" },
 *     cache: { kind: "turso" },
 *   }
 *
 * Slot names: snake_case [a-z][a-z0-9_]{0,63} (same rule as tools).
 * Manifest output is `[{ name, kind, ...config }]` — names + kinds
 * only, no credential fields. Credentials are wired up at runtime
 * by Studio (via Convex providerKeys) or by the standalone runtime
 * (via localStorage / config panel).
 *
 * Browser-safe kinds only. Raw Postgres / MySQL / Mongo SRV are not
 * supported because they can't be reached from an iframe.
 */
function extractDatabaseDeclarations(raw) {
  if (raw == null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "workbook.config: 'databases' must be an object keyed by slot name (e.g. { main: { kind: 'supabase' } })",
    );
  }
  const out = [];
  for (const [name, decl] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
      throw new Error(
        `workbook.config: database slot name ${JSON.stringify(name)} must be snake_case [a-z][a-z0-9_]{0,63}`,
      );
    }
    if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
      throw new Error(`workbook.config: databases[${name}] must be an object`);
    }
    if (typeof decl.kind !== "string" || !VALID_DATABASE_KINDS.has(decl.kind)) {
      throw new Error(
        `workbook.config: databases[${name}].kind must be one of ${[...VALID_DATABASE_KINDS].join(", ")}`,
      );
    }
    const entry = { name, kind: decl.kind };
    if (typeof decl.access === "string") entry.access = decl.access;
    if (decl.agentAccess === true) entry.agentAccess = true;
    out.push(entry);
  }
  return out;
}

/** Validate the optional `host: { name, url, splashColor, logoSvg }`
 *  block. Omitted → null (runtime falls back to workbooks.sh).
 *  All fields are advisory; runtime hardens defaults if any are
 *  missing or malformed. */
function extractHostPointer(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("workbook.config: 'host' must be an object");
  }
  const out = {};
  if (typeof raw.name === "string" && raw.name.trim()) {
    out.name = raw.name.trim();
  }
  if (typeof raw.url === "string" && raw.url.trim()) {
    const u = raw.url.trim();
    if (!/^https?:\/\//.test(u)) {
      throw new Error(
        `workbook.config: host.url must be http(s):// — got ${JSON.stringify(u)}`,
      );
    }
    out.url = u.replace(/\/+$/, "");
  }
  if (typeof raw.splashColor === "string" && raw.splashColor.trim()) {
    // CSS color — accept anything browser-parseable. We strip
    // quotes/spaces but otherwise trust the author.
    out.splashColor = raw.splashColor.trim();
  }
  if (typeof raw.logoSvg === "string" && raw.logoSvg.trim()) {
    // Stored as a raw <svg> string. Runtime drops it into innerHTML —
    // safe only because the workbook author IS the splash-rendering
    // context (the splash never runs against untrusted SVG from
    // arbitrary recipients). If we ever surface third-party host
    // configs we'd want to sanitize here.
    out.logoSvg = raw.logoSvg;
  }
  return Object.keys(out).length ? out : null;
}

/** Validate the optional `wasm: { strategy, cdnBaseUrl?, variant? }`
 *  block. Default { strategy: "bundle" } preserves portability. wb-e19.10. */
function extractWasmStrategy(raw) {
  const defaults = { strategy: "bundle" };
  if (raw == null) return defaults;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("workbook.config: 'wasm' must be an object");
  }
  const strategy = raw.strategy ?? "bundle";
  if (strategy !== "bundle" && strategy !== "reference") {
    throw new Error(
      `workbook.config: wasm.strategy must be "bundle" or "reference" (got ${JSON.stringify(strategy)})`,
    );
  }
  if (strategy === "bundle") return { strategy: "bundle" };
  // reference mode — cdnBaseUrl is required.
  if (typeof raw.cdnBaseUrl !== "string" || !raw.cdnBaseUrl.trim()) {
    throw new Error(
      "workbook.config: wasm.strategy='reference' requires wasm.cdnBaseUrl (the CDN root URL for runtime assets).",
    );
  }
  if (!/^https?:\/\//.test(raw.cdnBaseUrl)) {
    throw new Error(
      `workbook.config: wasm.cdnBaseUrl must be http(s):// — got ${JSON.stringify(raw.cdnBaseUrl)}`,
    );
  }
  return {
    strategy: "reference",
    cdnBaseUrl: raw.cdnBaseUrl.trim().replace(/\/+$/, ""),
    // Variant tells the loader which pkg-* subdir to fetch. Defaults
    // to the resolved wasmVariant; the CLI overrides this with the
    // actually-selected variant before emitting the metadata tag.
    variant: typeof raw.variant === "string" ? raw.variant : null,
  };
}

/** Validate the optional `package: { mcp, skill }` block. Keep this
 *  intentionally small — packaging just controls how we *announce*
 *  the workbook's tools, not what they are.
 *
 *   package: {
 *     mcp:   { enabled: true, name?: "my-workbook" },
 *     skill: { enabled: true, name?: "my-workbook", persona?: "..." },
 *   }
 *
 *  Defaults: mcp.enabled = true when any tool is declared; skill
 *  disabled by default (the author has to opt in because skill
 *  bundles ship persona text that should be intentional). */
function extractPackageDeclarations(raw) {
  const out = {
    mcp:   { enabled: false },
    skill: { enabled: false },
  };
  if (raw == null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("workbook.config: 'package' must be an object");
  }
  if (raw.mcp !== undefined) {
    if (raw.mcp === false) out.mcp = { enabled: false };
    else if (raw.mcp === true) out.mcp = { enabled: true };
    else if (typeof raw.mcp === "object" && !Array.isArray(raw.mcp)) {
      out.mcp = {
        enabled: raw.mcp.enabled !== false,
        ...(typeof raw.mcp.name === "string" ? { name: raw.mcp.name } : {}),
      };
    } else {
      throw new Error("workbook.config: package.mcp must be boolean or object");
    }
  }
  if (raw.skill !== undefined) {
    if (raw.skill === false) out.skill = { enabled: false };
    else if (raw.skill === true) out.skill = { enabled: true };
    else if (typeof raw.skill === "object" && !Array.isArray(raw.skill)) {
      out.skill = {
        enabled: raw.skill.enabled !== false,
        ...(typeof raw.skill.name === "string" ? { name: raw.skill.name } : {}),
        ...(typeof raw.skill.persona === "string"
          ? { persona: raw.skill.persona }
          : {}),
      };
    } else {
      throw new Error("workbook.config: package.skill must be boolean or object");
    }
  }
  return out;
}

function extractIntegrationsList(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(
      "workbook.config: 'integrations' must be an array of toolkit slugs (e.g. [\"gmail\", \"github\"])",
    );
  }
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry) {
      throw new Error(
        "workbook.config: each entry in 'integrations' must be a non-empty string toolkit slug",
      );
    }
    const slug = entry.toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(slug)) {
      throw new Error(
        `workbook.config: integrations[${JSON.stringify(entry)}] must be a kebab/snake toolkit slug`,
      );
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

const PARAM_TYPES = new Set(["number", "integer", "string", "boolean"]);

function validateParamSchema(name, schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`workbook.config: params.${name} must be an object`);
  }
  if (typeof schema.type !== "string" || !PARAM_TYPES.has(schema.type)) {
    throw new Error(
      `workbook.config: params.${name}.type must be one of ${[...PARAM_TYPES].join(", ")} (got '${schema.type}')`,
    );
  }
  if (schema.minimum !== undefined && typeof schema.minimum !== "number") {
    throw new Error(`workbook.config: params.${name}.minimum must be a number`);
  }
  if (schema.maximum !== undefined && typeof schema.maximum !== "number") {
    throw new Error(`workbook.config: params.${name}.maximum must be a number`);
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      throw new Error(`workbook.config: params.${name}.enum must be a non-empty array`);
    }
  }
  if (
    schema.description !== undefined &&
    typeof schema.description !== "string"
  ) {
    throw new Error(`workbook.config: params.${name}.description must be a string`);
  }
}

function extractParamDeclarations(raw) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "workbook.config: 'params' must be an object keyed by snake_case param name",
    );
  }
  const out = {};
  for (const [name, decl] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
      throw new Error(
        `workbook.config: param name ${JSON.stringify(name)} must be snake_case [a-z][a-z0-9_]{0,63}`,
      );
    }
    validateParamSchema(name, decl);
    const entry = { type: decl.type };
    if (decl.minimum !== undefined) entry.minimum = decl.minimum;
    if (decl.maximum !== undefined) entry.maximum = decl.maximum;
    if (decl.enum !== undefined) entry.enum = decl.enum.slice();
    if (decl.default !== undefined) entry.default = decl.default;
    if (decl.description !== undefined) entry.description = decl.description;
    out[name] = entry;
  }
  return out;
}

function extractConnectDeclarations(raw) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("workbook.config: 'connect' must be an object keyed by env-var name");
  }
  const out = {};
  for (const [name, decl] of Object.entries(raw)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) {
      throw new Error(
        `workbook.config: connect[${JSON.stringify(name)}] must be UPPER_SNAKE_CASE [A-Z][A-Z0-9_]{0,63}`,
      );
    }
    if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
      throw new Error(`workbook.config: connect[${name}] must be an object`);
    }
    const inject = decl.inject;
    if (typeof inject !== "string") {
      throw new Error(`workbook.config: connect[${name}].inject is required`);
    }
    if (
      inject !== "bearer" &&
      !/^header:[A-Za-z][A-Za-z0-9-]{0,64}$/.test(inject) &&
      !/^query:[A-Za-z][A-Za-z0-9_]{0,64}$/.test(inject)
    ) {
      throw new Error(
        `workbook.config: connect[${name}].inject must be 'bearer' | 'header:Name' | 'query:name'`,
      );
    }
    const domains = Array.isArray(decl.domains) ? decl.domains : [];
    if (
      domains.length === 0 ||
      !domains.every((d) => typeof d === "string" && d.length > 0)
    ) {
      throw new Error(
        `workbook.config: connect[${name}].domains must be a non-empty array of host patterns`,
      );
    }
    const template =
      typeof decl.template === "string" && decl.template.length > 0
        ? decl.template
        : "{value}";
    out[name] = { inject, domains, template };
  }
  return out;
}
