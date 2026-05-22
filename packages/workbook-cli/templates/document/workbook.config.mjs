// Document workbook — prose-first artifact. Reads top-to-bottom.
// Defaults to wasmVariant: "none" since most documents don't import
// wb.* WASM APIs; escalate to "app" or "default" if you do.
export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  type: "document",
  version: "0.1",
  entry: "index.html",
  wasmVariant: "none",
};
