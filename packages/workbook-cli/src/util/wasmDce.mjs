// Per-workbook WASM dead-code elimination.
//
// Coarse variants ("none" / "app" / "minimal" / "default") cut at
// feature granularity. This module does a second pass at *function*
// granularity: given the set of wasm symbols the workbook actually
// references, ask binaryen to discard every other exported entry
// point and run --dce so the unreachable definitions go too.
//
// Result: a sliced .wasm that's strictly smaller than the variant's
// stock binary, often dramatically so when the workbook uses only
// a handful of the variant's exports.
//
// Caching: keyed by (variant-id, used-symbols hash, source-wasm
// hash). Same workbook + same runtime version = no rerun.
//
// wb-m1r. Best-effort — any binaryen failure falls back silently
// to the un-sliced source wasm so the build doesn't break.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import binaryen from "binaryen";

/** Always keep these exports — they're wasm-bindgen plumbing the
 *  generated JS bindings depend on regardless of which user
 *  functions are called. Dropping them breaks the binding loader. */
const ALWAYS_KEEP = new Set([
  "memory",
  "__wbindgen_malloc",
  "__wbindgen_realloc",
  "__wbindgen_free",
  "__wbindgen_exn_store",
  "__wbindgen_add_to_stack_pointer",
  "__wbindgen_export_0",
  "__wbindgen_export_1",
  "__wbindgen_export_2",
  "__wbindgen_export_3",
  "__wbindgen_export_4",
  "__externref_table_alloc",
  "__externref_table_dealloc",
  "__externref_drop_slice",
  "__wbindgen_describe",
  "__wbindgen_describe_closure",
  "__wbindgen_start",
  "__indirect_function_table",
]);

function hashKey(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : Buffer.from(p));
  return h.digest("hex").slice(0, 16);
}

/** Build the dead-code-eliminated wasm. Returns the bytes (or null
 *  on any error — caller falls back to the source bytes). */
async function buildSliced({
  sourceBytes,
  keepSymbols,
}) {
  const module = binaryen.readBinary(sourceBytes);
  try {
    /* Tell binaryen which wasm features the source uses, otherwise
     * the optimizer asserts when it sees memory.fill (bulk-memory),
     * reference types, etc. Setting Features.All accepts whatever
     * wasm-bindgen emitted; we re-emit with the same feature set. */
    module.setFeatures(binaryen.Features.All);

    /* Walk every export. Remove the ones not in keepSymbols, then
     * run optimization passes that include DCE. binaryen's
     * removeExport leaves the function definition behind for the
     * pass manager to garbage-collect. */
    const exportCount = module.getNumExports();
    for (let i = exportCount - 1; i >= 0; i--) {
      const exp = module.getExportByIndex(i);
      const info = binaryen.getExportInfo(exp);
      if (!info || !info.name) continue;
      if (keepSymbols.has(info.name)) continue;
      if (ALWAYS_KEEP.has(info.name)) continue;
      /* Only strip function exports — keep memory / table / global
       * exports because the JS loader binds against them by name. */
      if (info.kind !== binaryen.ExternalFunction) continue;
      module.removeExport(info.name);
    }
    /* -O3 includes DCE + many other passes. Cheap for the wasm
     * sizes we're working with (typical: 100KB–10MB), 0.3–2s
     * single-threaded. */
    binaryen.setOptimizeLevel(3);
    binaryen.setShrinkLevel(2);
    module.optimize();
    return module.emitBinary();
  } finally {
    module.dispose();
  }
}

/** Public entry. Slices `sourceWasmPath` against `usedSymbols`,
 *  caches under ~/.cache or /tmp, returns absolute path to the
 *  sliced wasm. On any error returns the source path. */
export async function dceWasm({
  sourceWasmPath,
  variant,
  usedSymbols,
}) {
  if (!usedSymbols || !(usedSymbols instanceof Set) || usedSymbols.size === 0) {
    return sourceWasmPath;
  }
  let sourceBytes;
  try {
    sourceBytes = await readFile(sourceWasmPath);
  } catch {
    return sourceWasmPath;
  }
  const sourceHash = hashKey(sourceBytes);
  const symbolsHash = hashKey([...usedSymbols].sort().join("\n"));
  const cacheDir = join(tmpdir(), "workbook-wasm-dce");
  const out = join(cacheDir, `${variant}-${sourceHash}-${symbolsHash}.wasm`);
  try {
    const cached = await stat(out);
    if (cached.isFile() && cached.size > 0) return out;
  } catch {
    /* not cached */
  }
  try {
    const slicedBytes = await buildSliced({
      sourceBytes,
      keepSymbols: usedSymbols,
    });
    if (!slicedBytes || slicedBytes.length === 0) return sourceWasmPath;
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, slicedBytes);
    return out;
  } catch (err) {
    /* binaryen exceptions tend to be opaque; log and bail. */
    process.stderr.write(
      `[workbook] wasm-dce skipped: ${err?.message ?? err}. Using source binary.\n`,
    );
    return sourceWasmPath;
  }
}
