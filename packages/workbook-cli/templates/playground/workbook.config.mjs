// Playground starter — an spa workbook that mounts a STAGE primitive
// (iframe-wrapping another workbook) with toggleable side panels and a
// bottom terminal. "Playground" is descriptive shorthand for this
// pattern — type is the canonical "spa", the stage block carries the
// pattern's config. Effects panel auto-generates controls from the
// wrapped workbook's tool manifest; sliders write into a shared Y.doc
// that the wrapped workbook reads. See `workbook explain` for rules.
export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  entry: "index.html",
  type: "spa",
  stage: {
    // What this stage wraps. Must be a URL or relative path —
    // 'http(s)://...', '/absolute/path', './sibling.html', or
    // '../other-project/dist/x.html'. Bare slugs aren't supported.
    //
    // Scaffolded to point at the sibling demo workbook created alongside
    // this one. Build the wrapped first (`cd ../%%WRAPPED_SLUG%% &&
    // workbook build`), then this path resolves.
    wraps: "../%%WRAPPED_SLUG%%/dist/%%WRAPPED_SLUG%%.html",
    // Panel layout. left/right accept "effects" or "chat"; bottom accepts
    // "terminal" only. Set any to null to hide that side.
    panels: {
      left: null,
      right: "effects",
      bottom: null,
    },
  },
  // The stage host is a Svelte shell — it forwards effects and events
  // to the wrapped workbook but doesn't itself touch wasm. Switch to
  // "app" or larger if you customize the host to call wasm.*.
  wasmVariant: "none",
  // author: "Your name",
  // description: "One-sentence description of what this playground is for.",
};
