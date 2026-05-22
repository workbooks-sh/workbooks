// Specialty-coffee conference talk — reference deck demonstrating the
// design-first path with theme="base" + custom styles.css. See
// design.md for the visual identity (craft / editorial, warm paper,
// orange light-roast accent).
export default {
  name: "What 'specialty' coffee actually means",
  slug: "specialty-coffee",
  entry: "src/index.html",
  type: "presentation",
  wasmVariant: "none",
  description: "Conference talk: the SCA 80-point protocol vs the marketing claim.",
  // Auto-pick: omit source: and the CLI fans out across all 7 sources.
  // SCA (Specialty Coffee Association) is intentionally omitted — not in
  // any source and the deck makes the point without it.
  logos: [
    { id: "blue-bottle" },
    { id: "stumptown" },
    { id: "counter-culture" },
    { id: "onyx" },
    { id: "starbucks" },
    { id: "illy" },
  ],
};
