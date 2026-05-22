// The canonical kind=-based presentation pattern. Pairs with the
// workbook-presentation skill — every slide uses a declared archetype
// (title / section / content / stat / quote / process / chart / qa),
// styling comes from the default theme via CSS variables.
//
// For the manual-styling escape-hatch pattern (custom CSS per slide,
// no kind= archetypes), see ../presentation-svelte/.
export default {
  name: "Presentation basics",
  slug: "presentation-basic",
  entry: "src/index.html",
  type: "presentation",
  wasmVariant: "none",
  description: "Canonical <Slide kind=…> reference deck.",
  // Auto-pick mode: omit `source:` and the CLI fans out across all 7
  // sources (lobehub → svgl → iconify-logos → iconify-cib → devicon →
  // simple → pack) and uses whichever returns an SVG. Resolved source
  // for each id gets cached in node_modules/.cache/wb-logos/auto-cache.json
  // so repeat builds skip the failed-source attempts.
  logos: [
    { id: "openai" },
    { id: "stripe" },
    { id: "github" },
    { id: "fda" },        // resolves to the curated pack
  ],
};
