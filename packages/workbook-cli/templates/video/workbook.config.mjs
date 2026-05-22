// Video workbook starter — an `spa` workbook that mounts a Theater
// wrapping multiple Compositions (CW XML timelines). Video is a
// pattern, not a canonical shape — type stays "spa". See the
// workbook-video skill for narrative frameworks, archetypes, and the
// CW XML reference.
export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  type: "spa",
  entry: "index.html",
  // Theater + Composition don't touch wasm — opt out of inlining the
  // runtime entirely. Saves ~200 KB on the .html. Switch back to
  // "default" if a composition needs SQL, ML, or other wasm.
  wasmVariant: "none",
  // The compositions array is a passive manifest entry — declares which
  // CW XML files belong to this workbook so post-build tooling can
  // enumerate them. The actual list of <Composition src=...> renders
  // in App.svelte; keep them in sync.
  manifest: {
    compositions: ["intro.xml", "main.xml"],
  },
  // author: "Your name",
  // description: "One-sentence description of what this video workbook is for.",
};
