# Design system rules

These are the rules every presentation workbook follows by default.
The `<Presentation>` runtime ships sensible defaults that enforce
most of them; deviating from a default requires a reason.

The rules are stricter than for web pages. Slides are seen across
a room, often through a poorly-calibrated projector, by an audience
that didn't choose to focus on them. Treat the medium with the
respect it deserves.

---

## Design IS the first step

Before you choose a palette or pick a font or write a single slide,
**design the deck**. The runtime's `<Presentation>` has no `theme`
prop. It always loads structural archetype layout primitives (so
`<Slide kind="…">` works visually) with wireframe fallbacks, and
expects you to write a custom `src/styles.css` that overrides the
CSS-variable surface and adds per-archetype flourishes.

There is no "editorial / industrial / minimal" picker — that would
overconstrain design and produce generic decks for the wrong reason.

What this means for you, the author or agent:
- **Write a custom `src/styles.css`** for any deck where design
  matters. Define your palette + typography + voice via `:root`
  variable overrides (`--wb-color-*`, `--wb-font-*`, `--wb-*-size`,
  `--wb-spacing-unit`). Add per-archetype flourishes (e.g.
  drop-caps on `.wb-slide--content p:first-of-type::first-letter`,
  hairline rules on `.wb-slide--section`, etc.) as needed.
- **Skipping styles.css** is acceptable only for throwaway decks —
  the result is a wireframe (system fonts, basic sizing, near-
  white bg). That's the runtime telling you to design.

The custom CSS IS the design pass. The agent owns it.

See [designing-the-look.md](designing-the-look.md) for the variable
surface, palette discipline, typography choices, per-archetype
hooks, and a worked example of writing a custom theme.

The remaining rules in this doc explain WHY good defaults exist
and what design decisions to make — they apply on top of whatever
custom theme you write.

---

## Color

**The rule:** 1 dominant + 1 accent + 2 neutrals = 4 colors max
for chrome.

- **Dominant** — the brand color, used for headings, key UI, ~15%
  of pixels.
- **Accent** — high-contrast against dominant, used for emphasis,
  ~5% of pixels.
- **Neutrals** — background (~70%) and body text (~10%).

Charts, data viz, photos, and screenshots can use as many colors
as they need. Chrome cannot.

**Picking the palette:**
- Start with the brand's primary color (if there is one). If not,
  pick a desaturated dominant (e.g. slate-700, not pure blue).
- The accent is the dominant's complement OR a warm contrast
  (orange against blue, amber against teal). Avoid red unless
  warning is the message.
- Background: near-white (#FAFAFA) for light decks, near-black
  (#0F0F0F) for dark decks. Pure white and pure black hurt
  projector eyes.
- Body text: near-black on light, near-white on dark, contrast
  ratio AAA (7:1 against background).

**Anti-patterns:**
- Rainbow palette (4+ chrome colors).
- Saturated red as the dominant — reads as warning, not brand.
- Light-gray body text on white. Looks elegant in Figma, washes
  out under projector lights.

---

## Typography

**The rule:** 2 fonts max. One display, one body. A third font is
a bug.

- **Display** — used for titles, stat slides, section breaks.
  Geometric sans (Inter, Söhne, Aktiv Grotesk) or serif if the
  brand calls for it (Tiempos, Söhne Mono for technical decks).
  Sizes: 60-180pt depending on slide kind.
- **Body** — used for everything else. Highly legible at 28-48pt.
  Inter, IBM Plex Sans, or whatever the brand uses.

**Modular scale (start with these):**

| Use                | Size      |
| ------------------ | --------- |
| Stat slide hero    | 180pt     |
| Section break      | 96pt      |
| Slide title (h1)   | 64pt      |
| Sub-heading (h2)   | 40pt      |
| Body               | 32pt      |
| Caption / footer   | 20pt      |

**Critical rule from Kawasaki's 10/20/30:** no body text under
30pt. If you can't fit the content at 30pt, the content is wrong
for a slide.

**Anti-patterns:**
- Decorative fonts in body (Comic Sans, scripts, anything with
  ornaments).
- 3+ fonts (a third font is almost always trying to fix a layout
  problem with type — fix the layout instead).
- Body text < 30pt.
- Italic body. Use bold for emphasis on slides; italic doesn't
  read across a room.

---

## Spacing & grid

**The rule:** 30% whitespace minimum, every slide.

- Slide canvas: 16:9 = 1920×1080 logical units.
- Outer margins: 80px (4.2%) minimum on every side. 120px is better
  on heavy slides.
- Grid: 12 columns, 32px gutter. Use 6-col for hero / image / stat
  slides.
- Element spacing: powers of 2 starting at 8. (8, 16, 32, 64, 128.)
  Adjacent elements: 16-32px. Related elements: 8-16px. Unrelated
  elements: 64-128px.

**Whitespace test:** if you can't draw a rectangle covering 30% of
the canvas that contains zero ink, the slide is too dense.

**Anti-patterns:**
- Edge-to-edge content (no margins).
- Inconsistent spacing (16px here, 19px there, 22px elsewhere).
- Cramming because "I have one more thing to say." Make it another
  slide.

---

## Aspect ratio & viewport

**16:9 default.** This is what every modern projector and screen
expects.

- **4:3** only if the venue is academic / institutional AND they
  explicitly request it. Older lecture halls sometimes still ship
  4:3 projectors.
- **Vertical / 9:16** — don't. Workbook presentation isn't for
  Stories/Reels. If the user asks for vertical content, they want
  a different workbook (spa with a vertical layout).
- **Ultra-wide / 21:9** — don't. Most projectors letterbox; you
  lose pixels and look amateurish.

The runtime fixes the aspect ratio in `<Presentation>`. Slides
render in a letterboxed container so the deck looks identical on
any monitor; never depend on viewport size in your slide CSS.

---

## Contrast

**WCAG AAA for body text on slides.** AA (the web standard) is
not enough because projectors wash out 1-2 contrast steps.

- Body text against background: 7:1 minimum (AAA).
- Large text (24pt+) against background: 4.5:1 minimum (AAA-large).
- Chart axes / labels / annotations: 4.5:1 minimum.
- Decorative dividers, watermark logos: no minimum but be
  intentional.

Tool: any AAA contrast checker. The runtime ships a presenter-mode
warning that flags slides with contrast under AAA so you catch
them in rehearsal.

---

## Slide density rules (the 6×6 cap)

- **One idea per slide.** If a slide makes two points, it's two
  slides. No exceptions to this rule.
- **6 words per line max** for body text.
- **6 lines per slide max** for body text.

Exceptions (deliberate, listed in slide-archetypes.md):
- Stat slide — one giant number, no body text constraint.
- Title slide — title + subtitle only.
- Quote slide — one quote (can be longer if it's the whole slide).
- Image-only / full-bleed — image is the content.
- Code slide — code blocks aren't "body text" for the cap.
- Data viz / chart — same as code, the data is the content.

---

## Animation & transitions

**Default:** instant transition (no slide-to-slide animation).

- **Crossfade** acceptable for image-heavy or moody decks. Keep
  under 300ms.
- **Slide-from-side** acceptable for product launches if used
  sparingly (section breaks only).
- **Anything else** (zooms, flips, cubes, parallax) — don't.
  Looks like 2009 PowerPoint.

**Within a slide:** progressive reveal is OK for didactic content
(reveal one bullet, talk, reveal next). Reveal in the order the
presenter speaks. Never animate for animation's sake.

**The rule:** if the animation isn't doing narrative work, it's
distracting work.

---

## Image handling

- **Full-bleed** for hero images, demos, scene-setters. Image fills
  the canvas; title overlay if needed (bottom-left with backdrop).
- **Inline** for supporting images. Max 60% of the canvas; the
  remaining space carries a one-sentence caption.
- **Always crop intentionally.** Don't dump a 4:3 photo into a 16:9
  slide and let it letterbox.
- **No stock-photo cliché.** Handshakes, lightbulbs, "businessman
  pointing at chart" — never. If you have no good image, use the
  empty slide as a deliberate moment.

For sourcing brand logos see [logos.md](logos.md).

---

## Charts & data viz

- **One takeaway per chart slide.** Put the takeaway as the slide
  title (not "Q3 Revenue" but "Q3 revenue grew 32% YoY").
- **Annotate the data point you want them to see.** Don't make
  the audience hunt.
- **Drop chart-junk:** no 3D, no gradient fills, no excessive
  gridlines, no legend if you can label series in place.
- **One color emphasis.** If 5 lines are on the chart, 1 is in
  the accent color and 4 are in muted neutrals.
- **Axis labels readable from the back of the room** (24pt+).

For interactive charts, see
[interactive-components.md](interactive-components.md).

---

## Dark vs. light decks

- **Light** is the default. Easier to read in well-lit rooms;
  matches printed handouts.
- **Dark** for: product reveals, photography-heavy decks, evening
  events with dimmed lights, conference talks where you control
  the room lighting.
- **Pick one and commit.** Mixing dark and light slides in the
  same deck is jarring.

---

## What the runtime gives you for free

The `<Presentation>` runtime ships with:
- Fixed 16:9 aspect, letterboxed.
- Keyboard nav (arrows, space, ESC for overview).
- Presenter mode (P key) with notes, clock, next-slide preview.
- Overview mode (O key) for jumping between slides.
- AAA contrast warning in rehearsal mode.
- Print-to-PDF stylesheet.

You don't need to build any of these. Override only when you have
a specific reason.
