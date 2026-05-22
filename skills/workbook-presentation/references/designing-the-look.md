# Designing the look — writing a custom theme

There is no theme picker. Every deck that isn't a throwaway gets a
custom-designed visual identity, captured in a `styles.css` that
overrides the runtime's CSS-variable contract and adds per-archetype
flourishes.

You are the designer. This doc shows you the surface to design
against.

---

## The runtime always loads structural primitives

`<Presentation>` has **no `theme` prop**. It always loads the
archetype layout primitives (centered title slides, 2-column
comparison grid, numbered process flow, etc.) — the structural CSS
that makes `<Slide kind="…">` mean something visually. Every visual
choice in those primitives resolves through `var(--wb-*, fallback)`
where the fallbacks are wireframe values: system fonts, basic
sizing, near-white bg with near-black text.

You write `src/styles.css` to override the CSS variables and add
per-archetype flourishes. That file IS your theme. If you don't
write one, the deck looks like a wireframe — that's the correct
failure mode telling you to design.

There is deliberately no `theme="default" | "editorial" | …` picker.
Picking from a menu would overconstrain design.

---

## The variable surface

The runtime reads these CSS custom properties on
`.workbook-presentation` (you override them at `:root` or scoped to
`.workbook-presentation`). All have wireframe fallbacks baked into
the layout CSS, so unset values still render:

| Variable                | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `--wb-color-dominant`   | Primary brand color (headings, key UI, ~15% of pixels) |
| `--wb-color-accent`     | High-contrast emphasis (~5% of pixels)               |
| `--wb-color-bg`         | Background (light: near-white; dark: near-black)     |
| `--wb-color-text`       | Body text (AAA contrast against bg)                  |
| `--wb-color-muted`      | Captions, footers, secondary text                    |
| `--wb-font-display`     | Title/section/stat font stack                        |
| `--wb-font-body`        | Body font stack                                      |
| `--wb-font-mono`        | Code / monospace stack                               |
| `--wb-spacing-unit`     | Base spacing token (default 8px)                     |
| `--wb-slide-padding`    | Outer padding of every slide (default 96px)          |
| `--wb-title-size`       | Slide title (default 96px)                           |
| `--wb-section-size`     | Section break title (default 128px)                  |
| `--wb-stat-size`        | Stat slide hero number (default 240px)               |
| `--wb-body-size`        | Body text (default 32px)                             |
| `--wb-eyebrow-size`     | Captions / footers (default 18px)                    |
| `--wb-quote-size`       | Quote slide quote (default 56px)                     |
| `--wb-line-height`      | Default line-height multiplier (default 1.35)        |
| `--wb-max-line-length`  | Max measure in ch units (default 28ch)               |
| `--wb-radius`           | Corner radius for chrome (default 12px)              |
| `--wb-shadow`           | Box-shadow for chrome (default subtle)               |

Sizes are in **px** because slides render on a fixed canvas
(1920×1080 for 16:9) — the runtime scales the whole canvas
uniformly via transform: scale(). A 96px title is always visually
96px relative to the slide, just rendered smaller on a smaller
container.

---

## The archetype hook surface

Each `<Slide kind="…">` gets a `wb-slide--<kind>` class. Use these
to add per-archetype flourishes in your styles.css. The 14 archetypes:

`wb-slide--title`, `wb-slide--section`, `wb-slide--content`,
`wb-slide--stat`, `wb-slide--quote`, `wb-slide--image`,
`wb-slide--full-bleed`, `wb-slide--comparison`,
`wb-slide--process`, `wb-slide--code`, `wb-slide--chart`,
`wb-slide--demo`, `wb-slide--qa`, `wb-slide--backup`.

Helper classes baked into the archetype layouts:
- `.wb-slide-inner` — the padded content container inside every slide
- `.wb-slide-grid` — 2-column (or 3-col with `data-columns="3"`)
  inside `wb-slide--comparison`
- `.wb-slide-flow` — horizontal step flow inside `wb-slide--process`
- `.wb-slide-fallback` — the layered static image/video inside a
  `wb-slide--demo`

---

## A worked custom theme (real, end-to-end)

For a "Q3 board review" deck designed in `design.md` as clinical /
restrained, mono display, amber accent on slate — the styles.css
that implements it:

```css
/* src/styles.css — custom theme for a Q3 board review */

:root {
  /* Palette */
  --wb-color-dominant: #1F2937;          /* slate-800 */
  --wb-color-accent:   #F59E0B;          /* amber-500 */
  --wb-color-bg:       #FAFAFA;          /* near-white */
  --wb-color-text:     #1F2937;          /* matches dominant — single ink */
  --wb-color-muted:    #6B7280;          /* slate-500 */

  /* Typography — the monospace display signals "this is a numbers doc" */
  --wb-font-display:   "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
  --wb-font-body:      "Inter", ui-sans-serif, system-ui, sans-serif;

  /* Slightly tighter padding for a memo-like feel */
  --wb-slide-padding:  80px;
}

/* Per-archetype flourishes — keep small, intentional */

.workbook-presentation .wb-slide--stat .wb-slide-inner > p:first-child {
  /* Amber underline below the giant number */
  border-bottom: 4px solid var(--wb-color-accent);
  padding-bottom: 12px;
  display: inline-block;
}

.workbook-presentation .wb-slide--section .wb-slide-inner {
  /* Hairline rules above + below the section title */
  border-top: 1px solid var(--wb-color-accent);
  border-bottom: 1px solid var(--wb-color-accent);
  padding: 80px 0;
}

.workbook-presentation .wb-slide--process .wb-slide-flow > *::before {
  /* Override the base counter color to amber for this deck */
  color: var(--wb-color-accent);
  font-size: calc(var(--wb-body-size) * 1.5);
}
```

That's the whole theme. ~30 lines for a deck with its own identity.

---

## Design discipline (rules that hold under any theme)

These come from `design-system.md` and apply to your custom theme too:

1. **4 colors max for chrome.** 1 dominant + 1 accent + 2 neutrals
   (bg + text). Data viz / charts / photos can use more.
2. **2 fonts max.** One display, one body. A third font is a bug.
3. **30% whitespace minimum on every slide.** The test: can you
   draw a rectangle covering 30% of the canvas with zero ink? If
   not, the slide is too dense.
4. **AAA contrast for body text.** Projectors wash out AA.
5. **Don't reach for italic or thin weights on slides** — neither
   reads from the back of the room.

---

## How to write a custom theme — the process

1. **Read the design.md `Design / theme` section** the deck plan
   committed to. Palette + fonts + voice + per-archetype moves are
   already decided.
2. **Write `src/styles.css`** with `:root` overrides for every
   variable you're changing.
3. **Add per-archetype flourishes** only for the moves listed in
   the design plan. ≤3. Don't add design ideas that weren't in the
   plan — they create inconsistency.
4. **Confirm `<Presentation>` mounts your styles.css** (just link
   it from your index.html — the runtime auto-loads the layout
   primitives, no theme prop needed).
5. **Build + scrub** the deck at multiple viewport widths. Fixed-
   canvas scaling means the layout is identical at any size; what
   you're checking is whether the design choices actually carry.
6. **Run `workbook check dist/<slug>.html`** before declaring done.
   The lint catches palette drift (colors you used outside the
   theme palette), overflow, missing archetypes, near-duplicates.

---

## Common failure modes

- **Wireframe-looking decks** — usually means the author skipped
  step 1 (no design.md) and never wrote a styles.css. The runtime's
  fallback values make this obvious by design. Go back and design.
- **Inconsistent flourishes** — adding "this slide could use…"
  moves on the fly. Discipline: every per-archetype style was in
  the design plan or it doesn't ship.
- **Fighting the archetype layouts** — if you find yourself
  overriding 5+ structural layout rules, the archetype isn't a
  good fit for your design intent. Either pick a different
  `kind=` or drop down to plain `<section class="wb-slide">` and
  own the layout entirely for that one slide.
- **Color drift in charts** — chart SVGs often hard-code colors.
  Pull from `--wb-color-accent` etc. via inline `style` or a small
  JS injection so the chart palette stays in your theme.

---

## What this skill is NOT giving you

This skill does NOT ship 5 hand-curated themes you pick from. That
would over-impose design rules and produce decks that look generic
in a different way. You are capable of designing the deck. The
skill's job is to set you up to do that well — palette discipline,
typography rules, archetype hooks, the variable surface, the lint.
The design choices themselves are yours.
