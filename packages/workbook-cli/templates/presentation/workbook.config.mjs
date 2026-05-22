export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  type: "presentation",
  version: "0.1",
  entry: "index.html",
  // Presentations don't touch the wasm runtime — opt out of inlining
  // it entirely. Saves ~200 KB on the .html. Switch to "app" / "minimal"
  // / "default" if a slide needs SQL, ML, or other wasm-backed surfaces.
  wasmVariant: "none",
};
