# HyperFrames inside a gamut composition

A **HyperFrames scene** is the visual content of a single `<gm-scene>`
inside a gamut composition. The scene's `<template>` carries the
HTML/CSS/JS that does the visual work — the gamut timeline
schedules when it mounts and unmounts, HyperFrames does the
rendering and animation.

There's no separate HF file format, no `composition="…"` attribute,
no scene/shot hierarchy. Every `<gm-scene>` IS a HyperFrames scene.

For the canonical, deeply-detailed HyperFrames spec, the source of
truth is the gamut-side skill bundle at
`packages/gamut/hyperframes/docs/SKILL.md` (+ `house-style.md`,
`patterns.md`, `visual-styles.md`, `data-in-motion.md`). Use it for
the Visual Identity Gate, layout-before-animation, named visual
styles, GSAP patterns, and data-driven motion.

This page documents the **gamut-specific wiring**: how scene content
lives inside `<gm-scene>`, the `hf:ready` / `hf:tick` runtime
contract, and the two non-obvious rules (explicit close tags + the
`<template>` wrapper).

## A scene, end-to-end

```html
<gm-scene id="hero" start="0.5s" duration="3s">
  <template>
    <h1 class="hero-title">Cut from evidence.</h1>
    <script>
      gamut.onReady("hero", () => {
        gsap.from(".hero-title", {
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

Everything inside `<template>` is inert at page-parse time. When the
gamut timeline advances into the scene's window, the runtime clones
the template content into a mount container, runs the inline
`<script>` once, then fires `hf:ready`. When the playhead exits the
scene, the mount container is removed.

## External scene files

Inline templates are preferred for self-contained compositions.
When a scene gets large enough to warrant its own file, point a
`<gm-scene>` at it with `src=`:

```html
<gm-scene id="hero" start="0.5s" duration="3s" src="./scenes/hero.html"></gm-scene>
```

The runtime fetches `scenes/hero.html` (relative to the composition
URL), uses its `<body>` content as the scene template, and mounts it
the same way as an inline template. The fetched file is plain HTML
— no `<gm-*>` elements, just the scene's markup and scripts.

## Two non-obvious rules

**1. Always write an explicit closing tag.** HTML5 doesn't support
self-closing custom elements — `<gm-scene … />` parses as
`<gm-scene …>` with the slash silently dropped, which swallows every
following sibling as a child. Write `<gm-scene …></gm-scene>` even
when empty.

**2. Inline scene content must live inside `<template>`.** Without
that wrapper, the browser executes scene `<script>` blocks once at
page parse (when the source `<gm-scene>` hasn't mounted yet) and a
second time when the runtime clones the content into the viewport.
`<template>` keeps the content inert until the runtime is ready for
it.

## The runtime contract

Two custom events drive scene-side animation:

| Event       | When                                  | `detail` shape                                       |
| ----------- | ------------------------------------- | ---------------------------------------------------- |
| `hf:ready`  | Once, when the scene mounts           | `{ sceneId, fps, startMs, durationMs }`              |
| `hf:tick`   | Every rAF tick while scene is active  | `{ sceneId, fps, frame, durationFrames }`            |

Both are dispatched on the scene's mount container, not on
`document`. Three ways to subscribe, in order of preference:

```js
// 1. The runtime exposes globals on register — no imports needed.
gamut.onReady("hero", ({ fps, durationMs }) => { /* … */ });
gamut.onTick("hero", ({ frame }) => { /* scrub-safe motion */ });

// 2. Or import from the package, when you're in a module context.
import { onReady, onTick } from "@work.books/gamut-hyperframes/ready";
onReady("hero", () => { /* … */ });

// 3. Raw event listener — useful when you don't have the sceneId.
addEventListener("hf:ready", (e) => {
  console.log(e.detail.sceneId, e.detail.fps);
});
```

Use `onReady` for one-shot entrance animations (GSAP, anime.js, CSS
keyframes). Use `onTick` for anything that needs to scrub correctly
with the playhead — frame-driven shaders, particles, anything you
want to be deterministic when the user drags the timeline.

GSAP runs on its own wall clock, so plain `gsap.from(...)` timelines
won't scrub backwards. For scrub-safe motion, drive a paused
`gsap.timeline()` from `onTick` by seeking to `frame / fps`.

## The 1920×1080 design canvas

Scenes author at the document's declared resolution (typically
`1920x1080`). Write CSS in absolute pixels at that size; the runtime
transform-scales the viewport to fit whatever container `<gm-doc>`
sits in.

```html
<gm-scene id="hero" start="0s" duration="3s">
  <template>
    <h1 style="font-size: 96px; left: 120px; top: 480px; position: absolute;">
      Hello.
    </h1>
  </template>
</gm-scene>
```

Anti-pattern: `width: 100vw` / `height: 100vh` inside a scene. The
scene's mount container is already canvas-sized — use `100%`
instead, or absolute pixel values.

## Where to dig deeper

The canonical HyperFrames authoring guidance lives in the gamut
skill bundle:

- **Visual Identity Gate** — every composition needs a defined
  visual identity before any HTML is written.
  (`packages/gamut/hyperframes/docs/SKILL.md`, "Visual Identity Gate".)
- **Layout Before Animation** — position elements at their hero
  frame in static CSS first; THEN add GSAP entrance/exit tweens.
  (`SKILL.md`, "Layout Before Animation".)
- **House style** — `packages/gamut/hyperframes/docs/house-style.md`.
- **Named visual styles** (Swiss Pulse, Editorial, etc.) —
  `packages/gamut/hyperframes/docs/visual-styles.md`.
- **Patterns** (text reveals, transitions, audio reactivity) —
  `packages/gamut/hyperframes/docs/patterns.md`.
- **Data-driven motion** —
  `packages/gamut/hyperframes/docs/data-in-motion.md`.

When in doubt: write the gamut wiring following this doc; write the
scene contents following the gamut HyperFrames skill bundle.
