# Motion Principles — design vocabulary for video workbook authors

> Adapted from colorwave's canonical pedagogy
> (`packages/colorwave/src/skills/hyperframes/references/motion-principles.md`
> + `house-style.md` + `data-in-motion.md`). Edit upstream first if
> these rules drift.

A shared vocabulary for the eight motion principles that show up
again and again in a video workbook. These are **design concepts**,
not runtime features — gamut has no recipe table, no
`principle="…"` attribute, no lookup that picks a curve for you.
You write every tween by hand inside a scene `<script>` block. This
page tells you what the principles mean, when each one fits, and
the kind of GSAP code that expresses them.

The taxonomy is distilled from Disney's twelve principles of
animation (Thomas & Johnston, *The Illusion of Life*) and was
encoded historically in colorwave's `gamut/crates/motion/src/principles.rs`.
That file is a useful reference for the names and the *feel* each
principle implies — gamut doesn't read it at runtime.

Project-specific overrides live in `motion.md` under the "Motion
Principles" section. The defaults below are what that file is
*differing from*.

## Guardrails — what you already know but violate

- **Don't use the same ease on every tween.** A common default is
  `power2.out` on everything. Vary like font weights — no more
  than 2 independent tweens with the same ease in a scene.
- **Don't use the same speed on everything.** A common default is
  0.4–0.5s. The slowest scene should be 3× slower than the
  fastest. Vary duration deliberately.
- **Don't enter everything from the same direction.** A common
  default is `y: 30, opacity: 0`. Vary: from left, from right,
  from scale, opacity-only, letter-spacing.
- **Don't use the same stagger on every scene.** Each scene needs
  its own rhythm.
- **Don't use ambient zoom on every scene.** Pick different
  ambient motion per scene — slow pan, subtle rotation, scale
  push, color shift, or nothing. Stillness after motion is
  powerful.
- **Don't start at t=0.** Offset the first animation 0.1–0.3s.
  Zero-delay feels like a jump cut.

## Easing is emotion, not technique

The transition is the verb. The easing is the adverb. A slide-in
with `expo.out` = confident. With `sine.inOut` = dreamy. With
`elastic.out` = playful. Same motion, different meaning. Choose
the adverb deliberately.

**Direction rules — not optional:**

- `.out` for elements entering. Starts fast, decelerates. Feels
  responsive. This is your default.
- `.in` for elements leaving. Starts slow, accelerates away.
- `.inOut` for elements moving between positions.

Ease-in for entrances feels sluggish. Ease-out for exits feels
reluctant.

## Speed communicates weight

| Range       | Feel                           |
|-------------|--------------------------------|
| 0.15–0.3s   | Energy, urgency, confidence    |
| 0.3–0.5s    | Professional, most content     |
| 0.5–0.8s    | Gravity, luxury, contemplation |
| 0.8–2.0s    | Cinematic, emotional           |

## Scene structure: build / breathe / resolve

Every scene has three phases. The temptation is to dump everything
into the build and leave nothing for breathe or resolve.

- **Build (0–30%)** — elements enter, staggered. Don't dump
  everything at once.
- **Breathe (30–70%)** — content visible, alive with ONE ambient
  motion.
- **Resolve (70–100%)** — exit or decisive end. Exits are faster
  than entrances.

## Transitions are meaning

- **Crossfade** = "this continues"
- **Hard cut** = "wake up" / disruption
- **Slow dissolve** = "drift with me"

Crossfading everything reads as soft and unfocused. Use hard cuts
for disruption and register shifts.

## Choreography is hierarchy

The element that moves first is perceived as most important.
Stagger in order of importance, not DOM order. Don't wait for
completion — overlap entries. Total stagger sequence under 500ms
regardless of item count.

## Asymmetry

Entrances need longer than exits. A card takes 0.4s to appear but
0.25s to disappear. Bake this into every pair of in/out tweens
you write — the runtime won't do it for you.

## Visual composition — frames are not pages

- **Two focal points minimum per scene.** The eye needs somewhere
  to travel. Never a single text block floating in empty space.
- **Fill the frame.** Hero text: 60–80% of width. Web-sized
  elements look anemic in video.
- **Three layers minimum per scene.** Background treatment (glow,
  oversized faded type, color panel). Foreground content. Accent
  elements (dividers, labels, data bars).
- **Background is not empty.** Radial glows, oversized faded type
  bleeding off-frame, hairline rules. Pure `#000` reads as
  "nothing loaded."
- **Anchor to edges.** Pin content to left/top or right/bottom.
  Centered-and-floating is a web pattern.
- **Split frames.** Data panel on the left, content on the right.
  Top bar with metadata, full-width below. Zone-based layouts,
  not centered stacks.

## Lazy defaults to question — AI design tells

If you're about to use one, pause and ask: is this a deliberate
choice for THIS content, or am I defaulting?

- Gradient text (`background-clip: text` + gradient)
- Left-edge accent stripes on cards/callouts
- Cyan-on-dark / purple-to-blue gradients / neon accents
- Pure `#000` or `#fff` (tint toward your accent hue instead)
- Identical card grids (same-size cards repeated)
- Everything centered with equal weight
- `power2.out` + `y: 30, opacity: 0` on every element

If the content genuinely calls for one — centered layout for a
solemn closing, cards for a real product UI mockup — use it. The
goal is intentionality, not avoidance.

## Color discipline

- Match light/dark to content: food, wellness, kids → light. Tech,
  cinema, finance → dark.
- One accent hue. Same background across all scenes.
- Tint neutrals toward your accent (even subtle warmth/coolness
  beats dead gray).
- Declare palette up front in `motion.md` — don't invent colors
  per-element.

## Background layer

Every scene needs visual depth — persistent decorative elements
that stay visible while content animates in. Without these, scenes
feel empty during entrance staggering.

Ideas (mix and match, 2–5 per scene):

- Radial glows (accent-tinted, low opacity, breathing scale)
- Ghost text (theme words at 3–8% opacity, very large, slow drift)
- Accent lines (hairline rules, subtle pulse)
- Grain/noise overlay, geometric shapes, grid patterns
- Thematic decoratives (orbit rings for space, vinyl grooves for
  music, grid lines for data)

All decoratives should have slow ambient motion — breathing,
drift, pulse. Static decoratives feel dead.

## Numbers and data

A number on its own floats in empty space. Pair every metric with
a visual element that gives it presence — a proportional fill bar,
a background color shift, a shape that represents the value, a
progress ring. The visual doesn't need to be a chart — it just
needs to fill the frame.

When successive stats belong to the same concept (Q1 → Q2 → Q3 →
Q4), keep them in the same visual space with the same aesthetic.
Only the VALUE changes. An aesthetic change should signal a new
concept, not a new number.

**Avoid web patterns for data:** no pie charts, no multi-axis
charts, no 6-panel dashboards, no gridlines / tick marks /
legends, no chart-library output. Build with GSAP + SVG/CSS, not
D3 or Chart.js.

## The eight principles — a design vocabulary

Each principle below is a *way of thinking* about a motion. The
defaults under each one are starting points — durations and curves
the principle tends to land on — not a contract. You're free to
deviate the moment the scene asks for it.

| Principle          | Typical ease (in / out)          | Typical duration       | Reach for it when…                                                              |
| ------------------ | -------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `anticipation`     | `back.out(1.4)` / `back.in(1.4)` | 600 ms in, 360 ms out  | A subject should wind up or overshoot before settling — hero numbers, kickers.   |
| `follow-through`   | `power2.out` / `power2.in`       | 500 ms in, 300 ms out  | A secondary element should drift after the lead settles.                         |
| `overlap`          | `sine.inOut`                     | 450 ms in, 270 ms out  | Several subjects animate simultaneously and you want them to stay legible.       |
| `ease-in`          | `power2.in`                      | 400 ms                 | A forward-moving exit. Subject accelerates *away*.                               |
| `ease-out`         | `power3.out`                     | 400 ms                 | A snappy generic entrance — slightly more confident than `power2.out`.           |
| `staging`          | `power3.out` / `power3.in`       | 700 ms in, 420 ms out  | A deliberate reveal of the most important element. One staging per scene.        |
| `timing`           | `sine.inOut`                     | 500 ms in, 300 ms out  | Ambient / atmospheric motion — background drifts, slow camera-like pans.         |
| `secondary-action` | `power1.out` / `power1.in`       | 350 ms in, 210 ms out  | Supporting beats that ride off the primary action. Calmer than the lead.         |

Exits run ~40% shorter than entrances by default — entrances deserve
more time than exits, per "Asymmetry" above.

### Anticipation

A slight wind-up before the main move, or an overshoot that
settles. Reads as "wake up and look at me." Use for hero numbers,
kickers, awards, the punchline of a scene. Avoid on every reveal
— overshoot fatigue dulls the effect fast.

```js
gamut.onReady("hero", () => {
  gsap.from(".hero-number", {
    y: 80,
    opacity: 0,
    scale: 0.92,
    duration: 0.6,
    ease: "back.out(1.4)",
  });
});
```

### Follow-through

Trailing inertia after a primary action. The lead lands; a
secondary element drifts in just behind it, as if dragged along.
Use to glue paired elements together (label after number, caption
after headline).

```js
gamut.onReady("scene", () => {
  const tl = gsap.timeline();
  tl.from(".lead", { y: 60, opacity: 0, duration: 0.5, ease: "power2.out" })
    .from(".trailer", { y: 24, opacity: 0, duration: 0.5, ease: "power2.out" }, "-=0.25");
});
```

### Overlap

Several subjects animate at once, but with offset start times so
each one stays readable. Sine easing keeps the motion soft enough
that the eye can track multiple lanes without locking onto one.

```js
gamut.onReady("grid", () => {
  gsap.from(".tile", {
    y: 40,
    opacity: 0,
    duration: 0.45,
    ease: "sine.inOut",
    stagger: { each: 0.08, from: "start" },
  });
});
```

### Ease-in

For exits. The subject starts slow and accelerates away — the
opposite of how it entered. Reads as "leaving with purpose."
Pair with a shorter duration than the matching entrance.

```js
gamut.onTick("scene", ({ frame, durationFrames }) => {
  if (frame === durationFrames - 12) {
    gsap.to(".lead", {
      y: -40,
      opacity: 0,
      duration: 0.4,
      ease: "power2.in",
    });
  }
});
```

### Ease-out

The workhorse entrance. Starts fast, decelerates into place. Use
for most content reveals where you don't want the motion itself
to call attention to itself. `power3.out` is slightly snappier
than the everyday `power2.out` default — reach for it when the
scene wants a bit more confidence.

```js
gamut.onReady("body", () => {
  gsap.from(".paragraph", {
    y: 30,
    opacity: 0,
    duration: 0.4,
    ease: "power3.out",
  });
});
```

### Staging

The deliberate, confident reveal of the *most important* element
in the shot. Slower than a generic entrance — the audience needs
time to register that this one matters. One staging per scene.
Two stagings dilutes both.

```js
gamut.onReady("hero", () => {
  gsap.from(".hero-title", {
    y: 100,
    opacity: 0,
    duration: 0.7,
    ease: "power3.out",
  });
});
```

### Timing

Ambient, atmospheric motion. Background drift, slow scale push,
breathing glow, hairline pulse. Long durations, gentle eases,
often looping. Without timing motion every scene feels frozen
during its "breathe" phase.

```js
gamut.onReady("bg", () => {
  gsap.to(".glow", {
    scale: 1.08,
    duration: 4.0,
    ease: "sine.inOut",
    yoyo: true,
    repeat: -1,
  });
});
```

### Secondary action

A supporting beat that rides off the primary action. Calmer ease,
shorter duration, smaller magnitude. The lead does the work; the
secondary makes the scene feel populated. Never louder than the
lead — that's a different principle (overlap or staging).

```js
gamut.onReady("scene", () => {
  const tl = gsap.timeline();
  tl.from(".headline", { y: 60, opacity: 0, duration: 0.5, ease: "power3.out" })
    .from(".underline", { scaleX: 0, transformOrigin: "left", duration: 0.35, ease: "power1.out" }, "-=0.2");
});
```

## Picking the right principle

When you're staring at a scene wondering which principle fits, ask:

1. **What's the most important element?** That gets `staging`.
2. **Does anything trail it?** That gets `follow-through` or
   `secondary-action`.
3. **Are multiple peers entering together?** That's `overlap`.
4. **Does the lead need a wind-up?** That's `anticipation`.
5. **What's alive in the background?** That's `timing`.
6. **How does anything leave?** That's `ease-in` (with shorter
   duration than the entrance).

You won't need all eight in every scene — most scenes touch three
or four. The principle is a label for the *intent* behind the
tween; the GSAP call is how you express it.
