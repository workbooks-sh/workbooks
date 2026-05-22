/**
 * Presentation SDK — standardized chrome for slide-shaped workbooks.
 *
 * Presentations are interactive HTML workbooks with a fixed-ratio stage.
 * Static PDF export uses the print layout: one slide per page, preserving
 * the configured aspect ratio.
 */

export { default as Presentation } from "./Presentation.svelte";
export { default as Slide } from "./Slide.svelte";
export { getPresentationContext, setPresentationContext } from "./context";
export type { PresentationApi } from "./context";
export { SLIDE_KINDS, isSlideKind } from "./kinds";
export type { SlideKind } from "./kinds";
// Structural archetype layout primitives — always loaded by
// <Presentation>. Exported here so authors who want to reuse the
// primitives outside the presentation runtime (e.g. embedding a
// single slide somewhere) can include them explicitly. The design
// (palette, typography, voice) is the author's, in their own
// styles.css. See workbook-presentation skill's
// references/designing-the-look.md for the variable surface.
export { PRESENTATION_LAYOUT_CSS } from "./layoutCss";

// Re-exported from the main runtime so presentation workbooks can
// `import { getLogos } from "@work.books/runtime/presentation"` without
// pulling the full barrel (which drags agentBashTool → just-bash →
// node:zlib and breaks Vite's browser bundle with `gunzipSync` not
// exported). Same shape as the wb.logos accessor.
export { getLogos } from "../logos";
export type { LogoMap, Logo } from "../logos";
