// Notebook workbook — cell-based linear runner with reactive DAG.
// Defaults to wasmVariant unset (resolves to "default"), since
// notebooks typically use wb.polars / wb.sql / wb.candle for analysis.
// Set wasmVariant: "minimal" if you only need SQL, or "none" if your
// cells are pure JS with no wb.* WASM APIs.
export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  type: "notebook",
  version: "0.1",
  entry: "index.html",
};
