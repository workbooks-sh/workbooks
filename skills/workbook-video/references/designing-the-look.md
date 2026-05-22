# Designing the look — writing a custom motion identity

There is no motion-identity picker. Every video workbook that
isn't a throwaway gets a custom motion identity, captured in a
`motion.md` + `styles.css` pair that the composition's gamut HTML
implements scene-by-scene.

**Design IS the first step. You are the designer.** This doc
shows you the surface to design against.

---

## The runtime is unopinionated by design

`<gm-doc>` has **no `theme` prop, no `motion-style` prop, no
preset enum, no archetype shorthand**. It loads the parser, the
frame resolver, the playhead, the scene mount, the audio mixer,
the chrome — the structural plumbing that turns a tree of `<gm-*>`
elements into a playing composition. It does not load a look.

Every visual choice — palette, typography, sizing, motion, eases,
transitions — lives in your `styles.css` and inside each
`<gm-scene>`'s `<template>` block. The runtime injects a thin
base stylesheet that hides data-only elements, positions the
viewport, and lays out the chrome bar — nothing else. An unstyled
composition is legible but visibly bare; that's the correct
failure mode telling you to design.

You write `motion.md` to declare the design contract. You write
`styles.css` to implement it. You write each scene's `<template>`
to deliver the motion. Those three artifacts ARE your motion
identity. There is deliberately no `style.named: "swiss_pulse" |
"velvet_standard" | …` runtime picker — picking from a menu would
over-impose design choices and produce videos that look generic
for the wrong reason. See [visual-styles.md](visual-styles.md) for
the same point with case studies.

---

## What the runtime exposes — the CSS custom-prop contract

The runtime's base stylesheet (`packages/gamut/runtime/src/style.ts`)
reads exactly six CSS custom properties. Every other visual
property is yours to define, in whatever variable namespace you
want.

| Variable              | Where it lands                                   | Fallback                                  |
| --------------------- | ------------------------------------------------ | ----------------------------------------- |
| `--gm-doc-bg`         | `<gm-doc>` background (outside the stage)        | `#000`                                    |
| `--gm-doc-fg`         | `<gm-doc>` default text color                    | `#fff`                                    |
| `--gm-doc-font`       | `<gm-doc>` default font stack                    | `system-ui, -apple-system, …`             |
| `--gm-chrome-bg`      | Transport bar background                         | `rgba(10, 10, 12, 0.92)`                  |
| `--gm-chrome-border`  | Transport bar top border                         | `rgba(255, 255, 255, 0.12)`               |
| `--gm-accent`         | Scrub-bar fill (the played-portion color)        | `#f59e0b`                                 |

`--gm-aspect` is set by the runtime from `<gm-doc aspect="…">` and
is not author-overridable.

That's the entire chrome surface. The stage itself (`.gm-stage`,
`.gm-viewport`) renders on top of a hard `#000` background — the
runtime doesn't theme the stage interior, because that's where
your composition's clips and scenes are drawing.

Everything else — title sizes, caption colors, the look of a
specific scene's headline — lives in custom properties or class
rules you define yourself. Pick a namespace and stay consistent.
Most authors land on `--<project>-*` (e.g. `--ledger-fg`,
`--ledger-accent`) to make it obvious where the variable came
from.

---

## Where motion lives

Inside `<gm-scene>` `<template>` blocks, never in the schedule.
Each scene fires `hf:ready` once on mount (exposed as
`gamut.onReady(sceneId, fn)`) and `hf:tick` every rAF while
active (`gamut.onTick(sceneId, fn)`). You write the animation
against whatever library makes sense — GSAP for most narrative
work, anime.js for keyframe sequences, raw WebGL/Three.js for
shader-driven beats, CSS animations for the dead simple cases.

```html
<gm-scene id="title" start="0.4s" duration="3s">
  <template>
    <h1 class="ledger-headline">Cut from evidence.</h1>
    <div class="ledger-divider"></div>
    <script>
      gamut.onReady("title", () => {
        gsap.from(".ledger-headline", {
          x: -80, opacity: 0, duration: 0.7, ease: "expo.out"
        });
        gsap.from(".ledger-divider", {
          scaleX: 0, transformOrigin: "left", duration: 0.6,
          delay: 0.25, ease: "expo.out"
        });
      });
    </script>
  </template>
</gm-scene>
```

Every animation is written explicitly — the library, the ease,
the duration, the direction. There is no `intent=`, no `kind=`,
no `principle=` attribute the runtime consumes. The discipline
lives in *your* prose (motion.md) and is enforced by your eyes
during scrub-review.

---

## The motion vocabulary you author against

Your motion.md should pick deliberate values for four things on
every animated beat. The runtime doesn't read these — they're how
*you* keep yourself honest.

| Slot         | What it answers                  | Examples                                          |
| ------------ | -------------------------------- | ------------------------------------------------- |
| Intent       | What is the subject doing?       | reveal, exit, scale, translate, tint              |
| Principle    | Which animation principle owns this beat? | staging, anticipation, secondary-action, timing, follow-through, overlap |
| Direction    | Where from / where to?           | up, down, left, right, in, out                    |
| Easing       | The GSAP/CSS ease                | `expo.out`, `sine.inOut`, `back.out(1.4)`, …      |

Principle is the load-bearing slot. See
[motion-principles.md](motion-principles.md) for the principle
catalogue with default ease + duration recommendations for each
`(principle, direction)` pair. Override only when the recipe
doesn't fit the moment.

The agent's job is to map the *brief* to these slots — what does
this beat need the viewer to feel, and which principle delivers
that feel? Defaulting to `ease: "power2.out", duration: 0.4, y: 40`
on every animation is the failure mode the principle catalogue
exists to prevent.

---

## Naming your own classes — the per-archetype hook pattern

gamut has no archetype enum. There's no `<gm-shot kind="title">`.
What works in practice: pick a class-name convention for the
archetypes your composition uses, then implement the look in
`styles.css` and the motion inside each scene's template. Apply
the class to the root element inside each scene's `<template>`.

| Archetype          | Suggested class hook          | Use for                                  |
| ------------------ | ----------------------------- | ---------------------------------------- |
| Title              | `.scene--title`               | Opening / closing brand stamp            |
| Content            | `.scene--content`             | The bulk — narrative beats with type     |
| Stat               | `.scene--stat`                | One number that has to land              |
| Talking-head       | `.scene--talking-head`        | Founder/customer/expert face + lower-third |
| B-roll             | `.scene--broll`               | Cutaway footage under VO                 |
| Demo / screen      | `.scene--demo`                | Screen recording or live capture         |
| Transition         | `.scene--transition`          | The handoff between two scenes           |
| Tag                | `.scene--tag`                 | Closing brand / URL / CTA card           |

The motion hooks for each archetype are different. A title scene
wants staging (one hero element decisively revealed). A
transition scene wants overlap (two things happening at once). A
stat scene wants anticipation (the number overshoots then
settles). Pick the principle that matches the archetype's job,
then write the styles.css flourish and the scene's JS to amplify
it.

---

## The three design-discipline rules

These hold under any motion identity. They are the motion-medium
parallels to presentation's color/font/whitespace rules.

### 1. The pacing rule

**The slowest beat in a video should be 3× slower than the
fastest.** A 15-second ad with every scene at 1.2 seconds is a
metronome — the viewer's brain stops counting. A 60-second
explainer where every animation runs at 0.4s reads as anxious.

Vary deliberately:
- Hero hold beats: 0.8–2.0s (cinematic, emotional)
- Standard content beats: 0.3–0.5s (professional, most content)
- Punch / hit beats: 0.15–0.3s (energy, urgency)

If you can't justify why a beat is fast or slow, it's
defaulting. Default = wireframe = re-design.

### 2. The easing-as-emotion rule

**Easing is the adverb on the verb of motion.** A slide-in with
`expo.out` = confident. With `sine.inOut` = dreamy. With
`elastic.out` = playful. Same motion, different meaning.

Direction discipline:
- `.out` for elements entering (decelerates into place — feels
  responsive). This is your default for reveals.
- `.in` for elements leaving (accelerates away — feels decisive).
- `.inOut` for elements moving between positions.

Using `.in` for entrances feels sluggish. Using `.out` for exits
feels reluctant. The wrong ease undermines the right beat.

### 3. The hierarchy-of-motion rule

**The element that moves first is perceived as most important.**
Stagger in order of importance, not DOM order. Don't wait for
completion — overlap entries. Total stagger sequence under 500ms
regardless of item count.

Corollary: if every element moves the same way, you're saying
nothing has hierarchy. Vary the principle on the lead element vs.
the supporting elements. The hero gets staging; the supporting
caption gets secondary-action.

---

## A worked motion identity (real, end-to-end)

For a 22-second hero video on the homepage of a financial-ops
SaaS — the brief is "feel like a Bloomberg terminal that learned
restraint" — the motion.md + styles.css + scene snippet that
implements it.

### `motion.md`

```yaml
---
version: 1
name: ledger-hero-22s
feel: "Cool, exact, and just barely fast. The viewer should feel that nothing
       in this video is a guess."
palette:
  bg: "#0B0E14"
  fg: "#E8ECF1"
  muted: "#6B7785"
  accent: "#8EE3F5"
typography:
  title: '"Söhne Mono", ui-monospace, SFMono-Regular, monospace'
  body:  '"Söhne", "Inter", system-ui, sans-serif'
pacing:
  default: medium
  cut_cadence_ms: 1100
motion:
  durations:
    hero: 900
    content: 420
    tag: 260
  rules:
    - "Lead element in every scene gets the principle=staging treatment. Supporting elements use secondary-action."
    - "No element enters from below. Everything slides from the left, ledger-style."
transitions:
  default: hard-cut
  overrides:
    intro_to_main: "overlap fade — 400ms"
---

# Ledger hero — motion

## Pacing & Rhythm
Open on a 2s hold of the headline. Resolve over 4 scenes, each ~5s. End on a
1.5s tag — exact, no decoration.

## Color & Palette
Single cyan accent (`#8EE3F5`) on the headline hairline and the scrub-bar
fill. Body text on deep navy-black so the accent reads electric.

## Do's and Don'ts
- DO let the hero number breathe — 1.2s hold before any supporting motion.
- DO drive captions from the transcript asset; don't hand-type captions into
  scene templates.
- DON'T enter ANY element from below. It reads as "web hero pattern."
- DON'T use elastic eases. Nothing overshoots — this is a finance product.
```

### `styles.css`

```css
/* styles.css — Ledger Hero motion identity */

:root {
  /* The six runtime-consumed properties */
  --gm-doc-bg:        #0B0E14;
  --gm-doc-fg:        #E8ECF1;
  --gm-doc-font:      "Söhne", "Inter", system-ui, sans-serif;
  --gm-chrome-bg:     rgba(11, 14, 20, 0.94);
  --gm-chrome-border: rgba(142, 227, 245, 0.18);
  --gm-accent:        #8EE3F5;

  /* Project-local tokens — referenced from scene templates */
  --ledger-bg:        #0B0E14;
  --ledger-fg:        #E8ECF1;
  --ledger-muted:     #6B7785;
  --ledger-accent:    #8EE3F5;
  --ledger-font-mono: "Söhne Mono", ui-monospace, SFMono-Regular, monospace;
  --ledger-font-body: "Söhne", "Inter", system-ui, sans-serif;
}

/* The stage interior — every scene inherits this */
.gm-viewport {
  background: var(--ledger-bg);
  color: var(--ledger-fg);
  font-family: var(--ledger-font-body);
}

/* Per-archetype flourishes — keep small, intentional */

.scene--title .ledger-headline {
  font: 96px/1.05 var(--ledger-font-mono);
  letter-spacing: -0.02em;
  border-bottom: 1px solid var(--ledger-accent);
  padding-bottom: 14px;
}

.scene--stat .ledger-stat-value {
  font: 220px/1 var(--ledger-font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.scene--tag {
  outline: 1px solid var(--ledger-muted);
  outline-offset: -1px;
  padding: 28px 36px;
}
```

### A scene that uses it

```html
<gm-scene id="open" start="0s" duration="3s">
  <template>
    <div class="scene scene--title">
      <h1 class="ledger-headline">Cut from evidence.</h1>
    </div>
    <script>
      gamut.onReady("open", () => {
        gsap.from(".ledger-headline", {
          x: -80, opacity: 0, duration: 0.9, ease: "expo.out"
        });
      });
    </script>
  </template>
</gm-scene>
```

That's the whole identity. ~30 lines of motion.md, ~35 lines of
styles.css, plus per-scene templates for a 22-second video with
its own voice.

---

## How to write a custom motion identity — the process

1. **Read the brief and the design.md.** Audience, channel,
   length, takeaway are decided before motion identity is.
2. **Write `motion.md`.** Front-matter first (the
   machine-readable tokens), then the body sections (Pacing,
   Color, Do's and Don'ts). Show it to the user. Get sign-off.
3. **Write `styles.css`.** Override the six runtime properties.
   Define your project-local tokens. Add per-archetype class
   rules only for the moves listed in motion.md (≤3).
4. **Write the gamut HTML.** Each `<gm-scene>` carries its
   archetype class on the root element of the `<template>`. Each
   `<script>` writes its animation explicitly — the ease, the
   duration, the direction — picking the values motion.md
   demands.
5. **Scrub and review.** Play the composition end-to-end in
   `gamut preview`. Pause on every scene — does the motion say
   what motion.md said it should?
6. **Run `gamut lint`** before declaring done.

---

## Common failure modes

- **Wireframe-looking videos** — usually means the author skipped
  motion.md and never wrote a styles.css. The runtime's bare
  defaults make this obvious by design. Go back and design.
- **Same ease on every animation** — typically `power2.out`
  reflexively pasted into every `gsap.from()` call. Re-read
  motion-principles.md and pick the ease the beat actually
  wants.
- **One pacing for everything** — if every scene is 0.4s, you
  have no rhythm. If every scene is 2s, you have no urgency. The
  3× rule exists to prevent both.
- **Picking from the case-study menu** — writing "use the
  swiss_pulse style" and walking away. There is no preset to
  select. The case studies in [visual-styles.md](visual-styles.md)
  are for inspiration, not for selection.
- **Custom fonts that don't load offline** — inline web fonts as
  base64 in the source bundle. A workbook is a single file; a
  font that 404s on the recipient's network destroys the
  identity.
- **Self-closing `<gm-*>` tags** — `<gm-asset … />` silently
  swallows every following sibling. Always write the explicit
  closing tag. (See gamut.md § "Two non-obvious rules.")

---

## What this skill is NOT giving you

This skill does NOT ship 8 pre-baked motion identities you pick
from. The eight identities in `visual-styles.md` are case
studies — examples of *how an identity emerges from a brief*, not
options to select. You are capable of designing the motion
identity. The skill's job is to set you up to do that well — the
runtime's CSS contract, the motion vocabulary, the principle
catalogue, the three discipline rules, the lint. The design
choices themselves are yours.
