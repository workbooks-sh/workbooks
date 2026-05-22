---
name: Workbook (video)
description: Use when the user wants a deck of video scenes — explainers, ads, demos, short-form video compositions. Authors write a single .html file with <gm-*> custom elements + inline HyperFrames scenes; the gamut runtime plays them in-browser; the gamut CLI handles editing operations and MP4 render. Triggers on "make a video workbook", "video explainer", "social ad", "product demo video", "short-form video", "render this composition", "play this composition".
---

# Workbook — video pattern

A video workbook is a portable `.html` file authored in the
**gamut** composition format. It plays in the browser via the
`@work.books/gamut-runtime` Web Components family (no Svelte
wrapper, no separate XML file — the HTML *is* the composition).

Pick this pattern when the deliverable is a video — a 15-second
social ad, a 90-second explainer, a product demo, a launch promo.
Pick `presentation` if the user wants to STEP through static
slides. Pick `spa` (without gamut) for general interactive apps.

## Hard rules (apply to every workbook shape)

1. One file output — exactly one `<slug>.html`. No siblings.
2. Plain `.html` extension. Identity is content-based, not filename.
3. Author with the `gamut` CLI (`gamut init`, `gamut preview`,
   `gamut lint`, `gamut verify`, `gamut render`).
4. Bare `.html` is canonical — runs in any browser, no bundler
   required for playback (the runtime tag self-bootstraps from
   unpkg in production; from a Vite virtual module in dev).
5. Persistent state belongs at workbooks.sh; the `.html` itself is
   stateless.

## Video-specific rules

1. **Design IS the first step. You are the designer.** Write
   `motion.md` BEFORE writing any gamut HTML or styles.css. The
   motion.md becomes the contract the HTML and CSS implement.
   There is **no `theme` prop**, **no `motion-style` prop**, **no
   preset enum** the runtime pattern-matches against — the
   agent's `motion.md` + `styles.css` pair IS the identity. The
   case studies in `visual-styles.md` are for inspiration, not
   selection. Skip motion.md and the second-revision agent is
   just guessing again.

2. **The `<gm-doc>` element drives the schedule.** Tracks, clips,
   scenes, audio cues, adjustment overlays — all live as
   `<gm-*>` custom elements inside `<gm-doc>`. **Animation lives
   inside `<gm-scene>` HTML, not in the schedule.** The runtime
   fires `hf:ready` when a scene mounts and `hf:tick` every
   frame; the scene's inline `<script>` attaches GSAP / CSS /
   WebGL motion. The agent writes the motion every time — no
   recipe library, no `intent="reveal"` shorthand, no
   `kind="fade"` shorthand. Missing motion is missing motion; the
   runtime renders exactly what's there.

3. **Scenes wrap content in `<template>`.** HTML5 doesn't support
   self-closing custom elements, AND `<script>` blocks inside
   `<gm-scene>` would otherwise run twice (once at page parse,
   once at mount). Wrap scene content in `<template>` to keep it
   inert until the runtime clones it at mount. See the scaffolded
   `gamut.html` for the canonical pattern.

4. **Scenes hard-cut by default — pair every entrance with an exit
   (or an overlap).** If you write `gsap.from(.subject, {opacity:0, …})`
   for the entrance, the element sits at its final state until the
   scene's window ends, then disappears in a single frame. The
   viewer sees that as a hard cut. The fix is one of:
   - **Write an exit tween**: `gsap.to(.subject, {opacity:0, …, delay: sceneDuration - exitDuration})` so the element fades out before unmount.
   - **Overlap the next scene** by 0.3–0.6s so its entrance bleeds into this one's still-visible state, and the cut becomes a crossfade.
   - **Mark the scene as a deliberate hard-cut endcard** by making it the final scene in the timeline (the terminal scene is exempt — nothing follows it).

   `gamut verify` flags missing exits as `scene-hard-cut` with an
   actionable message. The scaffolded `gamut.html` demonstrates the
   exit + overlap pattern between the title scene and the payoff.

5. **fps + resolution at the `<gm-doc>` root.** A workbook ships
   at one resolution. Cross-aspect exports are a Phase-10
   concern (native Rust render); for now, one comp = one aspect.

6. **Audio should cover the timeline edges, or the leading /
   trailing silence will feel like the comp "starts late" or
   "ends early."** `gamut lint` warns `audio-leading-silence` /
   `audio-trailing-silence` when any `<gm-audio>` cue is declared
   but doesn't cover frame 0 or the last frames. If silence is
   intentional (a dramatic pause), ignore the warnings.

7. **`gamut render` exists** — headless Chromium + ffmpeg
   produces an MP4 from the same HTML the browser plays. Audio
   renders too (offline mixer with vol/pan/duck/fade matching
   `audioMixer.ts` envelope math).

## Quick start

```bash
gamut init my-explainer
cd my-explainer
gamut preview gamut.html            # iterate live
gamut lint gamut.html               # structural checks
gamut verify gamut.html             # render-query in headless browser
gamut render gamut.html -o out.mp4  # encode to MP4
```

The scaffolded `gamut.html` includes a working composition with
two scenes (title + payoff), a background gradient, and an
adjustment grade — all under 50 lines. Replace the content; the
structure stays.

## Design IS the first step. You are the designer.

Before you write a single line of gamut HTML or styles.css, **design
the video's motion identity**: palette, typography, pacing,
eases, transitions, per-archetype motion moves. Capture it in
`motion.md` (the motion contract) and `design.md` (the audience,
takeaway, shot list). Then implement them in a custom
`src/styles.css` that overrides the runtime's CSS-variable
contract and in the gamut HTML that drives the timeline.

This is the work. Most of the value of a video workbook is in the
design — the motion identity, the pacing, the silence between
beats. Skipping the design pass produces videos that look like a
wireframe — that's not a bug, it's the runtime telling you to
design.

There is deliberately no `theme` prop, no `motion-style` prop, no
preset enum, no `style.named: "swiss_pulse"` selector. Picking from
a fixed menu would over-impose design choices and produce videos
that look generic for the wrong reason. Custom is the only path.
The eight identities in `visual-styles.md` are case studies for
inspiration, not options to select.

### The CSS-variable contract

The player chrome reads six CSS custom properties from your
`styles.css`. Override them in your `gm-doc` selector to theme the
chrome. Everything else in the composition is your own CSS — these
are just the runtime's surface:

| Variable             | Purpose                          | Fallback                  |
| -------------------- | -------------------------------- | ------------------------- |
| `--gm-doc-bg`        | document background              | `#0a0a0c`                 |
| `--gm-doc-fg`        | document foreground              | `#f4f4f0`                 |
| `--gm-doc-font`      | document font stack              | system-ui sans-serif      |
| `--gm-chrome-bg`     | transport bar background         | `rgba(10,10,12,0.92)`     |
| `--gm-chrome-border` | transport bar top border         | `rgba(255,255,255,0.12)`  |
| `--gm-accent`        | scrub fill + interactive accents | `#f59e0b`                 |

With no styles.css the chrome falls back to monochrome defaults —
that's the correct failure mode (the composition tells you to
design, rather than papering over the lack of identity with a
preset).

See [references/designing-the-look.md](references/designing-the-look.md)
for the motion vocabulary, the three discipline rules, and a worked
example of designing a motion identity from scratch.

## A composition is a single HTML file

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
    <script type="module" src="/__gamut_bootstrap__"></script>
    <script src="https://unpkg.com/gsap@3.13.0/dist/gsap.min.js"></script>
  </head>
  <body>
    <gm-doc fps="30" resolution="1920x1080" aspect="16:9">

      <gm-asset id="vo"       kind="audio"      src="./assets/vo.mp3" />
      <gm-asset id="vo-words" kind="transcript" src="./assets/vo.words.json" />

      <gm-timeline id="main" duration="6s">

        <gm-track id="content" z="10">
          <gm-scene id="hello" start="0.4s" duration="3s">
            <template>
              <h1 class="hello">Cut from evidence.</h1>
              <script>
                gamut.onReady("hello", () => {
                  gsap.from(".hello", { y: 60, opacity: 0, duration: 0.7, ease: "back.out(1.6)" });
                });
              </script>
            </template>
          </gm-scene>
        </gm-track>

        <gm-track id="grading" z="20">
          <gm-adjustment start="0s" duration="6s" filter="contrast(1.05) saturate(1.08)"></gm-adjustment>
        </gm-track>

        <gm-track id="vo" z="0">
          <gm-audio asset="vo" start="0.5s" duration="5.5s" volume="1.0"></gm-audio>
        </gm-track>

      </gm-timeline>
    </gm-doc>
  </body>
</html>
```

Each `<gm-doc>` is a complete composition. Big projects can split
into multiple comps and use `<gm-include>` to reference one from
another. See [references/gamut.md](./references/gamut.md) for the
full element list, time grammar, and lifecycle events.

## When to load each reference

Load by need.

| If the user wants…                                            | Load                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| the design.md template for planning a video (do this FIRST for non-trivial videos) | [references/design-plan.md](references/design-plan.md) |
| to plan the motion identity contract (write motion.md alongside design.md) | [references/motion.md](references/motion.md)          |
| to design the custom motion identity from scratch (CSS surface, motion vocabulary, discipline rules) | [references/designing-the-look.md](references/designing-the-look.md) |
| to know what kind of video this is + what to model it after   | [references/types.md](references/types.md)            |
| the universal motion pedagogy (easing, pacing, framing)       | [references/motion-principles.md](references/motion-principles.md) |
| case studies of motion identities (read for inspiration, NOT a picker) | [references/visual-styles.md](references/visual-styles.md) |
| help picking a narrative structure for a short video          | [references/frameworks.md](references/frameworks.md)  |
| pick the right composition archetype for the content          | [references/composition-archetypes.md](references/composition-archetypes.md) |
| to write GSAP animations (timelines, intent-to-tween map)     | [references/gsap.md](references/gsap.md)              |
| the gamut HTML schema + time-string grammar                       | [references/gamut.md](references/gamut.md)          |
| to author the HF HTML scenes that gamut HTML schedules            | [references/hyperframes.md](references/hyperframes.md) |
| logos for brand stamps, customer walls, lower-thirds          | [references/logos.md](references/logos.md)            |
| to embed live components in shots (cells, agents, branching, scrubable charts) | [references/interactive-components.md](references/interactive-components.md) |

## Plan-first rule

**Write `design.md` + `motion.md` FIRST for non-trivial videos.**

For any video workbook that is:

- More than 1 composition, OR
- Longer than 30 seconds total, OR
- Has a named audience or distribution channel,

…draft `design.md` (audience, takeaway, type, framework, shot
list, asset inventory, audio plan) AND `motion.md` (the motion
identity contract — feel, palette, typography, pacing, eases,
transitions). Get the user's sign-off on both before writing
gamut HTML or HF HTML. A 90-second video with 30 shots rebuilds in
5 minutes if the two docs are locked. Without them, every
revision risks the identity.

Trivial videos (single 5-second title card, throwaway clip, 1-shot
prototype) skip both docs. Use judgment — when in doubt, lean
toward writing them.

See [references/design-plan.md](references/design-plan.md) and
[references/motion.md](references/motion.md) for templates.

## What the runtime gives you

- **Player chrome** — bottom-anchored transport bar inside
  `<gm-doc>`: play/pause button, scrub bar with hover, elapsed /
  total time (`M:SS` format).
- **`<gm-clip>` video rendering** — `<gm-clip asset="…" in="…"
  out="…">` mounts an `<HTMLVideoElement>` synced to the playhead.
  `in`/`out` are source-side timestamps. The element pauses when
  the playhead exits the clip range.
- **`<gm-scene>` lifecycle** — when the playhead enters a scene
  window, the runtime clones the scene's `<template>` content into
  a positioned mount container, fires `hf:ready`, and fires
  `hf:tick` on every rAF frame. When the playhead exits, the
  mount is removed. Scene scripts attach motion via
  `gamut.onReady("scene-id", () => gsap.from(...))`.
- **`<gm-audio>` mixer** — Web Audio mixer with per-cue volume,
  pan, duck (dB attenuation imposed on other cues), fade-in,
  fade-out. Playhead-driven; scrubbing rewinds cleanly.
- **`<gm-adjustment>` overlays** — CSS `filter` / `backdrop-filter`
  / `mix-blend-mode` applied to the viewport during the
  adjustment's window. Multiple active adjustments compose in z
  order.
- **Design-first chrome theming** — see the `--gm-*` CSS variable
  contract in the "Design IS the first step" section above.
- **Playhead access** — scene scripts read the live frame via
  `gamut.onTick("scene-id", ({ frame, fps }) => …)` for bespoke
  per-frame logic (scrub-safe motion, transcript word-highlight,
  audio-reactive visuals).

## Captions

Captions are an **asset + an HF scene** — there's no first-class
`<caption>` element. Declare the transcript as an asset, then write
a scene that reads it and renders the active words however you
want. No mode enum, no anchor shorthand, no recipe library.

```html
<gm-asset id="vo-words" kind="transcript" src="./assets/vo.words.json"></gm-asset>

<gm-track id="captions" z="20">
  <gm-scene id="captions" start="0s" duration="12s">
    <template>
      <div class="cap-stage"><span class="cap"></span></div>
      <script>
        // The scene reads the transcript JSON and updates a span
        // every hf:tick based on the current frame. The agent
        // designs the styling, the highlight pattern, the position.
        const words = await fetch("./assets/vo.words.json").then(r => r.json());
        gamut.onReady("captions", () => {});
        gamut.onTick("captions", ({ frame, fps }) => {
          const ms = (frame / fps) * 1000;
          const active = words.find(w => ms >= w.start_ms && ms < w.end_ms);
          document.querySelector(".cap").textContent = active?.text ?? "";
        });
      </script>
    </template>
  </gm-scene>
</gm-track>
```

Transcript JSON is a flat array of `{ text, start_ms, end_ms }`,
emittable by `gamut transcribe <audio> -o words.json`. The shape
matches both whisper.cpp segment-level and openai-whisper
word-level output.

State derives from the playhead frame — pausing and scrubbing keep
the caption in sync without an internal timer.

## What the runtime does NOT give you yet

- **Audio render in `gamut render`** — v0 renders video only; audio
  cues are silent in the MP4. Filed under wb-4nlm. The native Rust
  path (wb-lsw0) will mix audio properly via symphonia.
- **`<gm-shader>` runtime** — currently registered as a data-only
  stub; full WebGL/wgpu compilation deferred.
- **`<gm-include>` runtime** — recursive composition mounting
  deferred.
- **Per-element animation tracking in `gamut verify`** — current
  whole-scene maxOpacity check catches "every element ends
  invisible" but not "one named element ends invisible while
  others stay visible". Filed.
- **Auto-reframe constraints** — cross-aspect rendering (a single
  comp → 16:9 + 9:16 outputs) is a Phase-10 native-Rust concern.

## Canonical upstreams

The motion principles, hyperframes vocabulary, and the eight
motion-identity case studies in `visual-styles.md` live in the
gamut-hyperframes package; when these refs drift, edit there
first.

- **HyperFrames authoring docs:**
  `packages/gamut/hyperframes/docs/` (SKILL.md, house-style.md,
  patterns.md, visual-styles.md, references/)
- **gamut runtime source:**
  `packages/gamut/runtime/src/` (parser, timeline, lint, runtime)
- **gamut CLI source:**
  `packages/gamut/cli/src/` (init, inspect, lint, preview, verify,
  render, transcribe, trim, split, cut, concat, move)

The workbook-video skill stays in sync with these; when the
canonical docs change, the workbook-video refs follow.
