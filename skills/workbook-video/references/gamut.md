# gamut — the composition format

> Source of truth: `packages/gamut/runtime/src/types.ts` (IR types),
> `packages/gamut/runtime/src/parser.ts` (HTML walker),
> `packages/gamut/runtime/src/timeline.ts` (frame resolver). This
> page is the author-facing summary.

A gamut composition is a **single HTML file** carrying a tree of
`<gm-*>` custom elements. The browser parses it; the
`@work.books/gamut-runtime` Web Components registry registers the
element family; `<gm-doc>` orchestrates parse → resolve → playback
into a viewport scaled to the document's resolution.

There's no separate XML file. The HTML is the composition.

## Document skeleton

```html
<!doctype html>
<html lang="en">
<head>
  <link rel="stylesheet" href="./styles.css">
  <!-- In dev (gamut preview): served by a Vite virtual module. -->
  <!-- In production: swap to a real unpkg URL. -->
  <script type="module" src="/__gamut_bootstrap__"></script>
  <script src="https://unpkg.com/gsap@3.13.0/dist/gsap.min.js"></script>
</head>
<body>
  <gm-doc fps="30" resolution="1920x1080" aspect="16:9">

    <gm-asset id="hero-vid" kind="video"      src="./assets/hero.mp4"></gm-asset>
    <gm-asset id="vo"       kind="audio"      src="./assets/vo.mp3"></gm-asset>
    <gm-asset id="vo-words" kind="transcript" src="./assets/vo.words.json"></gm-asset>

    <gm-composition id="intro" src="./comps/intro.html"></gm-composition>

    <gm-timeline id="main" duration="12s">
      <gm-track id="base" z="0">
        <gm-clip asset="hero-vid" start="0s" in="2s" out="9s"></gm-clip>
      </gm-track>

      <gm-track id="overlays" z="10">
        <gm-scene id="title" start="0.5s" duration="3s">
          <template>
            <h1 class="title">Cut from evidence.</h1>
            <script>
              gamut.onReady("title", () => {
                gsap.from(".title", { y: 60, opacity: 0, duration: 0.7, ease: "back.out(1.6)" });
              });
            </script>
          </template>
        </gm-scene>
      </gm-track>

      <gm-track id="grading" z="20">
        <gm-adjustment start="0s" duration="12s" filter="contrast(1.05) saturate(1.08)"></gm-adjustment>
      </gm-track>

      <gm-track id="vo" z="0">
        <gm-audio asset="vo" start="0.5s" duration="11s" volume="1.0"></gm-audio>
      </gm-track>
    </gm-timeline>
  </gm-doc>
</body>
</html>
```

## Required attributes on `<gm-doc>`

| Attribute    | Format        | Example      |
| ------------ | ------------- | ------------ |
| `fps`        | integer       | `30`         |
| `resolution` | `WxH`         | `1920x1080`  |
| `aspect`     | `W:H`         | `16:9`       |

All required. Missing fields are lint errors — the runtime never
substitutes defaults.

## Element list

| Element | Children | Required attrs |
|---|---|---|
| `<gm-doc>` | assets, compositions, timeline | `fps`, `resolution`, `aspect` |
| `<gm-asset>` | — | `id`, `kind`, `src` |
| `<gm-composition>` | — | `id`, `src` |
| `<gm-timeline>` | tracks | `id`, `duration` |
| `<gm-track>` | items | `id`, `z` |
| `<gm-clip>` | — | `asset`, `start`, (`duration` OR `in`+`out`) |
| `<gm-scene>` | `<template>` with HTML/CSS/JS | `start`, `duration` |
| `<gm-audio>` | — | `asset`, `start`, `duration` |
| `<gm-shader>` | (CDATA-like inline OR `src`) | `lang`, `start`, `duration` |
| `<gm-adjustment>` | — | `start`, `duration`, `filter` |
| `<gm-include>` | — | (`ref` XOR `src`), `start`, `duration` |

Pass-through on every element: `class=`, `style=`. No other enums.
No `intent`, no `kind`, no `mode`, no `anchor` shorthand, no
`principle`, no recipe library. Authors write the full motion every
time.

## Two non-obvious rules

**1. Every gm-* element must have an explicit closing tag.** HTML5
doesn't support self-closing custom elements — `<gm-asset … />` is
treated as `<gm-asset …>` with the slash silently dropped, and
every following sibling gets swallowed as a child. Always write
`<gm-asset …></gm-asset>`.

**2. Inline scene content goes inside `<template>`.** The browser
runs `<script>` blocks at HTML parse time. Without `<template>`
wrapping, a scene's script would execute twice — once at page
parse (when the source `<gm-scene>` is still hidden via CSS), once
again at mount (when the runtime clones the content into the
viewport). Templates keep the content inert until the runtime
clones it.

## Time strings

Three forms, pick whichever reads best.

| Form              | Meaning                                        |
| ----------------- | ---------------------------------------------- |
| `"24f"`           | 24 absolute frames                             |
| `"5s"`            | 5 seconds (= `fps × 5` frames)                 |
| `"1.5s"`          | 1.5 seconds — must resolve to whole frames     |
| `"00:04:12:08"`   | SMPTE timecode `HH:MM:SS:FF`                   |

**Rule:** at 30fps, `0.5s` works (15 frames). `0.01s` does NOT
(0.3 frames). The resolver rejects sub-frame precision rather
than rounding silently — surfacing the bug to the author beats
shipping a timing skew downstream.

`gamut lint` catches sub-frame precision and every other bad time
string with a `bad-time` error including the original value and
the parse reason — run it before `gamut preview` if you're not
sure your durations land cleanly.

## Where animation lives

Inside `<gm-scene>` HTML, never in the schedule. The runtime fires
`CustomEvent("hf:ready", { detail: { sceneId, fps, startMs, durationMs } })`
on the scene's mount container when it appears, and
`CustomEvent("hf:tick", { detail: { sceneId, fps, frame, durationFrames } })`
every rAF tick while the scene is active.

```html
<gm-scene id="hero" start="0.4s" duration="3s">
  <template>
    <h1 class="hero">Hello.</h1>
    <script>
      // gamut.onReady / gamut.onTick are globals the runtime
      // exposes on register. No imports required for the common
      // case.
      gamut.onReady("hero", () => {
        gsap.from(".hero", { y: 60, opacity: 0, duration: 0.7, ease: "back.out(1.6)" });
      });
      // gamut.onTick("hero", ({ frame }) => { ... })  // for scrub-safe motion
    </script>
  </template>
</gm-scene>
```

The agent picks the animation library (GSAP, anime.js, CSS Web
Animations, raw WebGL/Three.js, Lottie). The runtime knows nothing
about which library — it just fires the events and renders the
DOM the library produces.

## Where transitions live

There are no `<gm-transition>` elements. Three honest options for
transition-feeling cuts:

1. **Overlap two `<gm-scene>` elements** — each scene's inline JS
   does its own fade-in / slide / etc. The visual transition is
   the overlap window.
2. **Write a `<gm-shader>` element** — a WGSL fragment shader that
   crossfades the previous track output with the next. Inline
   source or `src=`. Runtime support is stub-only today (filed).
3. **Hard cut** — adjacent scenes with no overlap. The default. No
   special syntax needed.

## How CW XML differs (legacy)

If you've authored against the previous `cw-xml.md` (deprecated
and being removed), the migration shape:

| CW XML | gamut |
|---|---|
| Separate `.xml` file + scene `.html` files | Single `.html` file with inline `<gm-scene>` templates |
| `<sequence>` → `<scene>` → `<shot>` (3-level nesting) | `<gm-timeline>` → `<gm-track>` → items (flat, z-ordered) |
| `<clip>`, `<layer>`, `<caption>`, `<animation>`, `<transition>` | `<gm-clip>`, `<gm-audio>`, `<gm-scene>`, `<gm-shader>`, `<gm-adjustment>` |
| `intent="reveal"`, `kind="fade"`, `mode="word-highlight"` recipes | No recipes — author writes the motion explicitly |
| `<caption>` as first-class | Captions are an asset + an HF scene that reads/renders them |
| `<exports>` for cross-aspect | Phase 10 native-Rust concern |
| `<Theater>` + `<Composition>` Svelte wrappers | `<gm-doc>` is the orchestrator; no Svelte |

The replacement substrate (`@work.books/gamut-runtime`) lives in
`packages/gamut/runtime/`; the CLI (`gamut`) is at
`packages/gamut/cli/`.
