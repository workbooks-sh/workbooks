# motion.md — the design contract for a video workbook

> Adapted from the canonical Motion spec in the colorwave repo
> (`packages/gamut/crates/motion/MOTION.md/SPEC.md`). This is the
> author-facing surface for workbook-video. If you maintain the
> spec, edit upstream first; this file is the workbook-context port.

For a video workbook, `motion.md` plays the same role `design.md`
plays for a presentation workbook: **it is the design contract that
both `gamut.html` and `styles.css` implement**. Write it first. Get
the user's sign-off. Then write code.

A motion.md file describes the **motion, voice, pacing, and
compositional identity** of one video composition (or a whole
workbook of compositions). `gamut.html` schedules and carries the
inline scene markup; `styles.css` implements the look; motion.md is
what they both answer to.

## File format

```
---
<YAML front matter — machine-readable tokens>
---

# <freeform title>

## <canonical section>
<rationale, examples, anti-patterns, do's and don'ts>
```

The front matter is a YAML mapping. The body is markdown organized
into `##` sections.

## Required fields

- `version: 1`
- `name: <string>` — human label for the file

`feel` is strongly encouraged: a one-sentence answer to *"what
should the viewer FEEL?"* It drives most downstream decisions.

Everything else is optional. Unknown fields are preserved.

## Front-matter token groups

| Group | Purpose |
|---|---|
| `feel` | Single sentence: what the viewer should FEEL |
| `anti_patterns` | Lazy defaults the agent should question |
| `palette` | Color tokens by role (bg, surface, fg, accent, …) |
| `typography` | Font stacks and roles (`title`, `lower_third`, `caption`) |
| `pacing` | `default: slow\|medium\|fast\|veryfast`, `cut_cadence_ms` |
| `motion` | GSAP-aligned: `eases`, `durations`, `rules` |
| `voiceover` | `voice_id`, `speed`, `persona`, `pause_convention` |
| `captions` | `word_grouping`, `position`, `halo`, `contrast` |
| `composition` | `aspect_ratios`, `stage_prefs`, `headroom`, `anchor_strategy` |
| `transitions` | `default` plus per-scene `overrides` |
| `overlays` | `halo_default`, `panel_default` |

## No foundation picker

Earlier drafts of this file taught a `style.named: swiss_pulse`
front-matter field as a "pick a foundation, override the diff"
pattern. **That pattern is rejected** for the same reason the
presentation skill has no theme picker: it overconstrains design
and produces motion identities that look generic for the wrong
reason. There is no canonical-foundations enum the runtime
pattern-matches against.

Every motion.md describes the project's full identity from
scratch. Use [visual-styles.md](./visual-styles.md) as case
studies for inspiration — not as a checklist of foundations to
inherit from. If your identity ends up looking like Swiss Pulse,
that's a coincidence of topic-fit, not a `style: swiss_pulse`
declaration.

See [designing-the-look.md](./designing-the-look.md) for the
design-from-scratch workflow + a worked example.

## Body sections (canonical order)

Sections are conventional, not normative. Any present must appear
in this order. Custom sections are allowed.

1. Overview
2. Anti-Patterns *(AI design tells to self-monitor for — see motion-principles.md)*
3. Pacing & Rhythm
4. Voiceover & Script
5. Typography & Captions
6. Color & Palette
7. Composition & Framing
8. Motion Principles *(project-specific overrides of the universal pedagogy)*
9. Audio & Sound Design
10. Transitions
11. Overlays & Halos
12. Do's and Don'ts *(this project's rules)*

`Anti-Patterns` and `Do's and Don'ts` are separate by design. The
first lists AI design tells (gradient text, centered-and-floating,
identical card grids). The second lists *this project's* rules
("don't use cyan on body text", "don't push pacing past `fast` for
the hero").

## Minimal example

```yaml
---
version: 1
name: my-launch-promo
feel: "Confident, momentum-building, end on a sharp brand stamp."
palette:
  bg: "#0B0B0F"
  fg: "#F5F5F7"
  accent: "#FFB300"
typography:
  title:
    family: ["Inter Display", "system-ui"]
  body:
    family: ["Inter", "system-ui"]
pacing:
  default: fast
  cut_cadence_ms: 800
transitions:
  default: hard-cut
---

# My Launch Promo — motion

## Pacing & Rhythm
Build over the first three scenes; resolve fast. No scene over 4s.

## Do's and Don'ts
- DO use the amber accent only on the headline numerals.
- DON'T animate the logo — it appears once, dead-center, no movement.
```

## How the workbook runtime uses it

The runtime does not auto-parse motion.md — it's a contract for
the **agent**, not the runtime. Every choice in the file maps to
something the agent writes, by hand, into `gamut.html` or
`styles.css`:

- `palette` → CSS custom properties in `styles.css`. The gamut
  runtime defines six chrome tokens it reads itself: `--gm-doc-bg`,
  `--gm-doc-fg`, `--gm-doc-font`, `--gm-chrome-bg`,
  `--gm-chrome-border`, `--gm-accent`. Set these to your palette's
  roles. Any other color tokens (`--accent-warm`, `--surface-2`,
  whatever) are author-defined — name them whatever the design
  warrants and reference them from scene CSS.
- `typography` → `@font-face` declarations + author-defined custom
  properties in `styles.css`. The runtime does not ship typography
  tokens; the agent picks names (`--type-title`, `--type-caption`,
  …) and uses them inside scene styles.
- `pacing.default` + `motion.durations` → the `duration` argument
  the agent passes to `gsap.from/to/fromTo` inside each
  `<gm-scene>`'s `<script>` block, and the `duration` attribute on
  the `<gm-scene>` itself (which bounds the scene's lifetime).
- `motion.eases` → the `ease` argument to those same gsap calls:
  `gsap.from(".hero", { y: 60, opacity: 0, duration: 0.7, ease: "back.out(1.6)" })`.
  There is no recipe library to fall back to. If motion.md doesn't
  specify the ease for a moment, the agent picks one and writes it.
- Motion the design calls for → an explicit gsap (or anime.js, or
  Web Animations) call inside the scene `<template>`'s `<script>`.
  The agent writes the full tween every time; there is no `intent`
  / `kind` / `mode` shorthand the runtime expands.
- `transitions.default` → realized one of three ways: (a) overlap
  two `<gm-scene>` elements and have each one fade/slide itself in
  and out from its own script, (b) a `<gm-shader>` element for a
  WGSL crossfade (stub today), or (c) hard cut — adjacent scenes
  with no overlap and no special syntax.
- The motion.md as a whole → drives every decision above. There is
  no foundation-level shorthand — every value the agent picks gets
  written out, explicitly, in HTML + CSS + JS.

Concrete example. A motion.md fragment like:

```yaml
motion:
  durations:
    title_in_ms: 700
  eases:
    title_in: "back.out(1.6)"
```

becomes, in `gamut.html`:

```html
<gm-scene id="title" start="0.4s" duration="3s">
  <template>
    <h1 class="title">Cut from evidence.</h1>
    <script>
      gamut.onReady("title", () => {
        gsap.from(".title", {
          y: 60,
          opacity: 0,
          duration: 0.7,
          ease: "back.out(1.6)",
        });
      });
    </script>
  </template>
</gm-scene>
```

## Discovery

Place `motion.md` at the project root next to `gamut.html`. The
agent reads it when planning the composition tree and the
stylesheet. There is no live cascade right now — the agent reads
the single project-level file.

## Validation

A file is invalid only if `version` or `name` is missing or has the
wrong type. Validators must warn on unknown fields, not error.
Common drift to watch for: declared `feel:` contradicted by the
concrete values (a "calm, restrained" feel with `pacing.default:
veryfast` and `motion.eases.primary: back.out(2)`). Flag the
mismatch; don't auto-correct.

## Plan-first rule (re-stated)

Don't write a single line of `gamut.html` or `styles.css` until
the user has signed off on motion.md. The whole point of this file
is to make rebuilds cheap — if the visual identity is locked in
YAML, a 20-scene composition rebuilds without redesigning. Skip
motion.md and the second-revision agent is just guessing again.
