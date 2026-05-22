---
name: Workbook (presentation)
description: Build a portable single-file HTML workbook whose reader STEPS THROUGH SLIDES — investor pitches, conference talks, sales decks, product launches, keynotes, lecture decks, workshop decks. Use when the user asks for "a deck", "a pitch", "slides", "a presentation", "a keynote", anything with explicit slide-by-slide navigation, presenter mode, or full-viewport rules. For chat apps, dashboards, or interactive tools use the spa skill; for prose use the document skill.
---

# Workbook — `presentation` shape

A presentation workbook is a deck the reader STEPS THROUGH. Each
slide owns the full viewport. The runtime ships slide navigation
(arrow keys, swipe, presenter mode with notes + clock), fixed aspect
ratio, and the discipline that makes presentations look like
presentations — not like web pages with `<h1>` tags.

Pick this shape when the deliverable has slides. Pick `spa` if the
reader scrolls or interacts freely. Pick `document` if it's prose
the reader scrolls.

## Hard rules (apply to every workbook shape)

1. One file output — exactly one `<slug>.html`. No siblings.
2. Plain `.html` extension. Identity is content-based, not filename.
3. Author with `@work.books/cli`.
4. Bare `.html` is canonical — runs in any browser, source bundled inside.
5. Persistent state belongs at workbooks.sh; the `.html` itself is stateless.

## Presentation hard rules (do not violate)

These exist because they're what separates "real presentation" from
"web page in 16:9". If the user pushes back, push back gently and
explain the tradeoff — don't quietly bend the rules.

1. **One idea per slide.** If a slide makes two points, it's two
   slides. Density kills decks.
2. **6×6 cap.** No more than 6 words per line, 6 lines per slide.
   Title slides, stat slides, image-only slides are exceptions
   (see slide-archetypes.md).
3. **30% whitespace minimum.** Empty space is part of the design.
   A slide that looks "balanced and full" is too full.
4. **16:9 default.** Use 4:3 only if the venue is academic /
   institutional and explicitly requests it. Don't ship vertical.
5. **2 fonts max.** One display (titles), one body (everything
   else). A third font is a bug, not a feature.
6. **4 colors max.** 1 dominant + 1 accent + 2 neutrals. Charts and
   data viz can use more; chrome cannot.
7. **WCAG AAA contrast for body text.** Projectors wash out AA.
   Test with the lights up.
8. **No bullet-point dumps.** A slide that's six bullets and a
   title is a failure mode. Convert to a process slide, a comparison,
   a stat, or split into multiple slides.
9. **Never auto-advance.** Presenter triggers every transition.
10. **Always have a static fallback for interactive slides.** Demos
    fail. Screen recordings need to capture something coherent.

## Design IS the first step. You are the designer.

Before you write a single slide, **design the deck's visual identity**:
palette, typography, voice, motion. Capture it in `design.md`, then
implement it in a custom `src/styles.css` that overrides the runtime's
CSS-variable contract and adds per-archetype flourishes.

This is the work. Most of the value of a presentation is in the
design, not the slide content. Skipping the design pass produces
decks that look like a wireframe — that's not a bug, it's the
runtime telling you to design.

The `<Presentation>` component has **no `theme` prop**. The runtime
always loads structural archetype layout primitives (so
`<Slide kind="…">` means something visually no matter what), with
wireframe fallbacks for every visual choice. Your `styles.css` IS
the theme — palette, typography, voice, per-archetype flourishes.

There is deliberately no preset picker (no `theme="editorial"`,
`theme="industrial"`, etc.). Picking from a fixed menu would
overconstrain design and produce decks that look generic for the
wrong reason. Custom is the only path.

See [references/designing-the-look.md](references/designing-the-look.md)
for the CSS variable surface, palette discipline, typography choices,
per-archetype hooks, and a worked example of writing a custom theme.

## Before you write any slides — the plan-first rule

For any deck the user asks for that is:
- More than 5 slides, OR
- Has a named audience ("for our board", "for the engineering team",
  "for prospects"), OR
- Spans multiple sections,

…write `design.md` FIRST. Get the user's sign-off on the arc before
you generate slides. The cost of building a 25-slide deck and then
restructuring is 10× the cost of agreeing on the outline upfront.

See [references/design-plan.md](references/design-plan.md) for the
template.

Trivial decks (3-slide standup update, a single visual to share,
quick "explain this concept in 5 slides") skip `design.md`. Use
judgment — when in doubt, lean toward writing one.

## When to load each reference

Don't read everything at once. Load by need.

| If the user wants…                                              | Load                                              |
| --------------------------------------------------------------- | ------------------------------------------------- |
| help choosing a narrative arc                                   | [references/frameworks.md](references/frameworks.md) |
| to know what kind of deck this is + what to model it after      | [references/types.md](references/types.md)        |
| design-system rules (colors, type, spacing, grid)               | [references/design-system.md](references/design-system.md) |
| designing the deck's custom theme (palette, type, CSS surface)  | [references/designing-the-look.md](references/designing-the-look.md) |
| to pick the right slide TYPE for the content                    | [references/slide-archetypes.md](references/slide-archetypes.md) |
| to embed a live cell, demo, or stage in a slide                 | [references/interactive-components.md](references/interactive-components.md) |
| logos for company / tool / brand mentions                       | [references/logos.md](references/logos.md)        |
| the design.md template for planning a deck                      | [references/design-plan.md](references/design-plan.md) |

## Quick-start

Scaffold with the `workbook_init` tool:

```
workbook_init({
  slug: "my-deck",
  name: "My Deck",
  shape: "presentation",
  dest: "my-deck"
})
```

This produces the canonical presentation template with
`type: "presentation"` at root and slide markup in `index.html`.

A human author outside this sandbox uses:

```bash
npm install -g @work.books/cli
workbook init my-deck --shape=presentation
workbook dev
workbook build    # → dist/my-deck.html
```

In `workbook.config.mjs`:

```js
export default {
  slug: "my-deck",
  entry: "src/index.html",
  type: "presentation",
  // Optional: logos to fetch + inline at build time. See logos.md.
  // Omit `source:` to use auto-pick (recommended) — the CLI fans out
  // across all 7 sources and uses whichever returns an SVG.
  logos: [
    { id: "openai" },
    { id: "anthropic" },
    { id: "fda" },     // resolves to the curated pack
  ],
};
```

Then in `src/index.html`, slides are siblings of a
`<Presentation>` root:

```html
<Presentation>
  <Slide kind="title">
    <h1>Our 2026 Story</h1>
    <p>Q3 review · prepared for the board</p>
  </Slide>

  <Slide kind="stat">
    <p class="huge">3.2×</p>
    <p>revenue growth, quarter over quarter</p>
  </Slide>

  <Slide kind="content">
    <h2>What changed</h2>
    <p>One sentence that frames the next three slides.</p>
  </Slide>

  <!-- … -->
</Presentation>
```

`<Presentation>` ships with the runtime SDK. `<Slide kind="...">`
declares the archetype so the default styling, layout, and
whitespace rules apply automatically. See
[references/slide-archetypes.md](references/slide-archetypes.md)
for the full list.

## Embedding an agent in a presentation

A presentation with an embedded agent is unusual but valid — useful
for "ask me about the deck" closing slides, or for live Q&A where
the audience types and the agent answers using the deck's content
as context. Two patterns:

1. **End-of-deck Q&A slide** — last slide is a `<Slide kind="qa">`
   with a `<wb-agent>` mounted. The agent is fine-tuned on the
   deck content (passed as a system-prompt context block).
2. **Presenter co-pilot (private mode)** — agent runs in the
   presenter view only, helping the speaker recall facts, find
   slides, or generate ad-hoc visuals during Q&A. Reader never
   sees it.

For chat-first workflows where the agent IS the interface, you're
not building a presentation — switch to `spa`.

## Common pitfalls

- **Bullet-point reflex.** If you find yourself writing `<ul><li>`
  inside a content slide, stop and ask: is this really 6 ideas, or
  is it 1 idea with 6 sub-points? If the latter, the slide is
  about the idea, not the list.
- **"Just put the chart there".** Charts need a one-sentence
  takeaway above them, not just a title. The slide says what the
  chart shows; the chart proves it.
- **Custom fonts that don't load offline.** Inline web fonts as
  base64 in the source bundle. Stage presentations on bad wifi
  must not fall back to system fonts.
- **Demo slides without a fallback.** Always include a screenshot
  or static state for the slide so a screen recording works even
  when the demo doesn't.
- **Section breaks without breathing room.** A section transition
  is a full-bleed slide with the section name. Don't tuck it as
  a heading on the first content slide of the section.

## References

- Repo: https://github.com/workbooks-sh/workbooks
- Examples: `examples/presentation-basic/` (canonical `<Slide kind=…>` pattern, demonstrates auto-pick logos), `examples/presentation-svelte/` (manual-styling escape hatch with `<Slide class=…>`), `examples/payment-rails/` (longer real-world deck — payment rails reference)
- CLI on npm: `@work.books/cli`
- Hosted viewer: https://workbooks.sh
