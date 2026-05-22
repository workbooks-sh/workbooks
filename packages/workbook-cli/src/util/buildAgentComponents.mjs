/**
 * Build per-agent custom components into a single embedded script tag.
 *
 * Authors declare:
 *   agent: {
 *     components: { stoplight: "./src/components/stoplight.js" }
 *   }
 *
 * Each entry is a JS module whose default export is a factory:
 *   export default function (target, props, emit) {
 *     // build DOM, wire events
 *     return () => unmount;  // optional cleanup
 *   }
 *
 * This intentionally avoids any framework runtime (Svelte/React/Vue)
 * so agent components ship small and the substrate stays hackable.
 *
 * The build pipeline:
 *   1. esbuild each entry → IIFE that calls
 *      `globalThis.__wbAgentComponent(name, factory)`.
 *   2. gzip + base64 each bundle.
 *   3. Pack all into a JSON map `{ name: base64gz }`.
 *   4. Caller embeds in `<script id="wb-components" ...>JSON</script>`.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { gzipSync } from "node:zlib";

let esbuildMod = null;
async function getEsbuild() {
  if (!esbuildMod) {
    esbuildMod = await import("esbuild");
  }
  return esbuildMod;
}

const PROLOGUE = `(function(){"use strict";`;
const EPILOGUE = (name) =>
  `var __m=typeof exports!=='undefined'?exports:{};\n` +
  `var __d=__m.default||__m;\n` +
  `if(typeof __d==='function'&&globalThis.__wbAgentComponent){` +
  `globalThis.__wbAgentComponent(${JSON.stringify(name)},__d);` +
  `}})();`;

/**
 * Build all entries. Returns:
 *   { manifest: { components: ["name1","name2"] }, scriptJson: string }
 *
 * scriptJson is what to drop inside <script id="wb-components">.
 */
export async function buildAgentComponents(config) {
  const components = config.agent?.components;
  if (!components || Object.keys(components).length === 0) {
    return { manifest: { components: [] }, scriptJson: null };
  }
  const esbuild = await getEsbuild();
  const bundle = {};
  for (const [name, rel] of Object.entries(components)) {
    const entry = path.resolve(config.root, rel);
    try {
      await fs.access(entry);
    } catch {
      throw new Error(`agent.components.${name}: file not found at ${entry}`);
    }
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "browser",
      target: ["chrome120", "firefox120", "safari17"],
      minify: true,
      logLevel: "silent",
    });
    const inner = result.outputFiles?.[0]?.text ?? "";
    const wrapped = PROLOGUE + inner + "\n" + EPILOGUE(name);
    const gz = gzipSync(Buffer.from(wrapped, "utf8"));
    bundle[name] = gz.toString("base64");
  }
  return {
    manifest: { components: Object.keys(bundle) },
    scriptJson: JSON.stringify(bundle),
  };
}
