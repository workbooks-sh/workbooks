// The wrapped workbook — a tiny SPA designed to be loaded inside a
// playground. It declares one tunable parameter (`bgHue`) that the
// playground writes into a shared Y.doc. When opened standalone the
// param falls back to its declared default, so this file is fully
// runnable on its own — useful as a sanity check while iterating.
export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  entry: "index.html",
  type: "spa",
  // Params advertise tunables to the parent playground. Each entry
  // produces one control in the Effects panel; the playground writes
  // the live value into the shared Y.doc under `params.<key>`.
  // Names must be snake_case. See wb-22u.10 for the canonical schema.
  params: {
    bg_hue: {
      type: "integer",
      minimum: 0,
      maximum: 360,
      default: 200,
      description: "Hue of the centered swatch (0–360).",
    },
  },
  // The wrapped sample drives one CSS hue from a param — no wasm.
  // Switch to "app" or larger if you wire wasm-backed surfaces in.
  wasmVariant: "none",
  // author: "Your name",
  // description: "Minimal target for the sibling playground.",
};
