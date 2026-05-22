/**
 * Structural archetype layout primitives for `<Presentation>`.
 *
 * Loaded ALWAYS by the runtime — these are the rules that make
 * `<Slide kind="…">` mean something visually (centered title/stat/
 * quote/qa, 2-col comparison grid, numbered process flow, demo-slide
 * fallback z-index, etc.).
 *
 * Every visual choice resolves through `var(--wb-*, fallback)`. The
 * fallbacks are WIREFRAME values — system fonts, basic sizing, near-
 * white bg with near-black text, no accent — so an author who writes
 * no styles.css gets a functioning but obviously-undesigned deck.
 * That's the correct failure mode: the deck demands a design pass.
 *
 * Author overrides go in their project's styles.css via :root
 * variable redefinitions + per-archetype CSS targeting the
 * wb-slide--<kind> hooks. See workbook-presentation skill's
 * references/designing-the-look.md for the variable surface + a
 * worked custom theme.
 */
export const PRESENTATION_LAYOUT_CSS = String.raw`
.workbook-presentation .workbook-presentation-stage {
  background: var(--wb-color-bg, #fafafa);
  color: var(--wb-color-text, #111);
  font-family: var(--wb-font-body, system-ui, sans-serif);
}

.workbook-presentation .wb-slide-inner {
  padding: var(--wb-slide-padding, 64px);
  font-size: var(--wb-body-size, 28px);
  line-height: var(--wb-line-height, 1.4);
  color: var(--wb-color-text, #111);
}

.workbook-presentation .wb-slide h1,
.workbook-presentation .wb-slide h2,
.workbook-presentation .wb-slide h3 {
  font-family: var(--wb-font-display, system-ui, sans-serif);
  font-weight: 700;
  margin: 0 0 calc(var(--wb-spacing-unit, 8px) * 2) 0;
  line-height: 1.1;
  text-wrap: balance;
  max-width: var(--wb-max-line-length, 28ch);
}

.workbook-presentation .wb-slide h1 { font-size: var(--wb-title-size, 64px); }
.workbook-presentation .wb-slide h2 { font-size: calc(var(--wb-title-size, 64px) * 0.75); }
.workbook-presentation .wb-slide h3 { font-size: calc(var(--wb-title-size, 64px) * 0.55); }

.workbook-presentation .wb-slide p {
  margin: 0 0 calc(var(--wb-spacing-unit, 8px) * 2) 0;
  max-width: 42ch;
  text-wrap: pretty;
}

.workbook-presentation .wb-slide a {
  color: var(--wb-color-accent, #0066cc);
  text-decoration: none;
  border-bottom: 1px solid currentColor;
}

.workbook-presentation .wb-slide code,
.workbook-presentation .wb-slide pre {
  font-family: var(--wb-font-mono, ui-monospace, monospace);
}

.workbook-presentation .wb-slide--title .wb-slide-inner,
.workbook-presentation .wb-slide--qa .wb-slide-inner,
.workbook-presentation .wb-slide--stat .wb-slide-inner,
.workbook-presentation .wb-slide--quote .wb-slide-inner {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: calc(var(--wb-spacing-unit, 8px) * 2);
}

.workbook-presentation .wb-slide--stat .wb-slide-inner {
  align-items: center;
  text-align: center;
}
.workbook-presentation .wb-slide--stat .stat,
.workbook-presentation .wb-slide--stat strong,
.workbook-presentation .wb-slide--stat .value {
  font-family: var(--wb-font-display, system-ui, sans-serif);
  font-size: var(--wb-stat-size, 160px);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--wb-color-accent, var(--wb-color-text, #111));
  display: block;
}

.workbook-presentation .wb-slide--section .wb-slide-inner {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}
.workbook-presentation .wb-slide--section h1,
.workbook-presentation .wb-slide--section h2 {
  font-size: var(--wb-section-size, 96px);
  max-width: none;
}

.workbook-presentation .wb-slide--quote .wb-slide-inner {
  align-items: flex-start;
}
.workbook-presentation .wb-slide--quote blockquote,
.workbook-presentation .wb-slide--quote .quote {
  font-family: var(--wb-font-display, system-ui, sans-serif);
  font-size: var(--wb-quote-size, 48px);
  font-weight: 500;
  line-height: 1.2;
  margin: 0;
  text-wrap: balance;
  max-width: 22ch;
}

.workbook-presentation .wb-slide--qa .wb-slide-inner {
  align-items: center;
  text-align: center;
}
.workbook-presentation .wb-slide--qa h1 {
  font-size: var(--wb-section-size, 96px);
}

.workbook-presentation .wb-slide--content .wb-slide-inner {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: calc(var(--wb-spacing-unit, 8px) * 2);
}

.workbook-presentation .wb-slide--comparison .wb-slide-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: calc(var(--wb-spacing-unit, 8px) * 4);
  height: 100%;
  align-items: stretch;
}
.workbook-presentation .wb-slide--comparison[data-columns="3"] .wb-slide-grid {
  grid-template-columns: 1fr 1fr 1fr;
}

.workbook-presentation .wb-slide--process .wb-slide-flow {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: calc(var(--wb-spacing-unit, 8px) * 2);
  height: 100%;
  counter-reset: wb-step;
  overflow-x: auto;
  list-style: none;
  padding: 0;
  margin: 0;
}
.workbook-presentation .wb-slide--process .wb-slide-flow > * {
  flex: 1 1 0;
  min-width: 0;
  padding: calc(var(--wb-spacing-unit, 8px) * 3);
  position: relative;
  counter-increment: wb-step;
  list-style: none;
}
.workbook-presentation .wb-slide--process .wb-slide-flow > *::before {
  content: counter(wb-step);
  display: block;
  font-family: var(--wb-font-display, system-ui, sans-serif);
  font-size: var(--wb-eyebrow-size, 14px);
  font-weight: 700;
  color: var(--wb-color-accent, var(--wb-color-text, #111));
  margin-bottom: var(--wb-spacing-unit, 8px);
}

.workbook-presentation .wb-slide--image .wb-slide-inner,
.workbook-presentation .wb-slide--full-bleed .wb-slide-inner {
  padding: 0;
  display: grid;
  place-items: stretch;
}
.workbook-presentation .wb-slide--image img,
.workbook-presentation .wb-slide--full-bleed img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.workbook-presentation .wb-slide--code .wb-slide-inner {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: calc(var(--wb-spacing-unit, 8px) * 2);
}
.workbook-presentation .wb-slide--code pre {
  margin: 0;
  white-space: pre;
  font-size: var(--wb-code-size, 22px);
}

.workbook-presentation .wb-slide--chart .wb-slide-inner {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: calc(var(--wb-spacing-unit, 8px) * 2);
}
.workbook-presentation .wb-slide--chart figure,
.workbook-presentation .wb-slide--chart .wb-chart {
  margin: 0;
  min-height: 0;
  display: grid;
  place-items: stretch;
}

.workbook-presentation .wb-slide--demo {
  position: relative;
}
.workbook-presentation .wb-slide--demo .wb-slide-fallback {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: rgba(0, 0, 0, 0.05);
}
.workbook-presentation .wb-slide--demo .wb-slide-fallback img,
.workbook-presentation .wb-slide--demo .wb-slide-fallback video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.workbook-presentation .wb-slide--demo .wb-slide-inner {
  position: relative;
  z-index: 1;
}

.workbook-presentation .wb-slide--interactive::after {
  content: "▶";
  position: absolute;
  bottom: 16px;
  right: 16px;
  font-size: 14px;
  opacity: 0.5;
  color: var(--wb-color-accent, var(--wb-color-text, #111));
}
`;
