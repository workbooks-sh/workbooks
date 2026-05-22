// Canonical workbook shapes. Single source of truth.
//
// A workbook's shape describes what the READER does with it — not what
// is inside. Playgrounds are an spa pattern (agent + canvas packaged
// together), not a shape.
//
// Consumers (CLI, Studio, demo fixtures, anywhere else that branches on
// shape) import from here so future changes propagate. A CI drift-lint
// script greps the monorepo for stray shape values and fails the build
// if any non-canonical value shows up next to a `type:` / `manifest.type`
// site.
//
// This file is plain ESM so both the TypeScript runtime build AND the
// CLI's plain-Node `.mjs` scripts can consume it. Types live in
// shapes.d.ts alongside.

export const WORKBOOK_SHAPES = Object.freeze([
  "document",
  "notebook",
  "spa",
  "presentation",
  "agent",
]);

export const SHAPE_DESCRIPTIONS = Object.freeze({
  document: {
    label: "Document",
    description: "Long-form prose with embedded charts and tables.",
    readerDoes: "reads top-to-bottom",
  },
  notebook: {
    label: "Notebook",
    description: "Cells the reader re-runs to drive the computation.",
    readerDoes: "re-runs cells",
  },
  spa: {
    label: "App",
    description:
      "Full single-page app. Chat tools, dashboards, custom interfaces, agent playgrounds.",
    readerDoes: "uses an interface",
  },
  presentation: {
    label: "Presentation",
    description:
      "Slide deck with its own navigation, presenter mode, and full-viewport rules.",
    readerDoes: "steps through slides",
  },
  agent: {
    label: "Agent",
    description:
      "Responds to messages and writes outputs into a folder. Server-side LLM loop with its own publish path and Studio viewer.",
    readerDoes: "messages an agent and reads its outputs",
  },
});

/**
 * Brand colors per shape — used by pickers, cards, badges, anywhere
 * we visually identify a workbook by what shape it is. Solid fills
 * with white text so the badge stays readable on top of arbitrary
 * thumbnail content. Shades sit at the 600–700 range to clear the
 * WCAG AA threshold for white text. Chrome stays monochrome;
 * shape is the one place color identifies the artifact.
 */
export const SHAPE_COLORS = Object.freeze({
  document: {
    fg:   "#ffffff",
    bg:   "#4f46e5", // indigo-600
    ring: "#4f46e5",
  },
  notebook: {
    fg:   "#ffffff",
    bg:   "#047857", // emerald-700
    ring: "#047857",
  },
  spa: {
    fg:   "#ffffff",
    bg:   "#9333ea", // violet-600
    ring: "#9333ea",
  },
  presentation: {
    fg:   "#ffffff",
    bg:   "#b45309", // amber-700
    ring: "#b45309",
  },
  // rose-600 — distinct from indigo/emerald/violet/amber, reads as
  // "live conversation" rather than "static artifact".
  agent: {
    fg:   "#ffffff",
    bg:   "#e11d48", // rose-600
    ring: "#e11d48",
  },
});

/**
 * Type guard for runtime parsing of untrusted strings (e.g. from a
 * workbook.config.mjs at build time, or a manifest read at viewer
 * load). Returns false for any non-canonical value.
 */
export function isWorkbookShape(v) {
  return typeof v === "string" && WORKBOOK_SHAPES.includes(v);
}
