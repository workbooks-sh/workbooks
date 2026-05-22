# GSAP for workbook-video

> Adapted from the canonical GSAP skill at
> `vendor/colorwave/packages/colorwave/src/skills/gsap/SKILL.md`
> (and `references/effects.md`). Edit upstream first if these
> patterns drift.

In gamut, GSAP runs **inside the `<script>` block of a `<gm-scene>`
template**. The runtime exposes no animation element — there is no
`<animation>`, no `intent=`, no `principle=`. Authors write the
tween directly. The runtime's job is to mount the scene, fire
lifecycle events, and (optionally) drive your timeline off the
playhead. The motion itself is yours.

Load GSAP in the document `<head>`:

```html
<script src="https://unpkg.com/gsap@3.13.0/dist/gsap.min.js"></script>
```

## Lifecycle hooks the scene's script gets

The runtime exposes two globals — `gamut.onReady` and
`gamut.onTick` — that wire your script to the scene's lifecycle.

```html
<gm-scene id="hero" start="0.4s" duration="3s">
  <template>
    <h1 class="hero">Hello.</h1>
    <script>
      gamut.onReady("hero", () => {
        gsap.from(".hero", { y: 60, autoAlpha: 0, duration: 0.7, ease: "back.out(1.6)" });
      });
    </script>
  </template>
</gm-scene>
```

- `gamut.onReady(sceneId, cb)` — fires once, when the scene mounts
  and its DOM is ready. Equivalent to subscribing to
  `CustomEvent("hf:ready", { detail: { sceneId, fps, startMs, durationMs } })`
  on the scene's container.
- `gamut.onTick(sceneId, cb)` — fires every rAF tick while the
  scene is active. Callback receives
  `{ sceneId, fps, frame, durationFrames }`.

## Entrance + exit — pair them or expect a hard cut

A scene that only has a `gsap.from()` entry tween hard-cuts to the
next scene at its end. The element finishes its entrance, sits at
its final state for the back half of the scene window, then
disappears in a single frame when the scene's mount unmounts. The
viewer sees a pop.

Three patterns that avoid the pop:

**A — Explicit exit tween, no overlap.** Add a delayed `gsap.to()`
that fades the element out before the scene's end. Easiest to
reason about; works for any scene.

```html
<gm-scene id="title" start="0.4s" duration="3.1s">
  <template>
    <h1 class="title">Cut from evidence.</h1>
    <script>
      gamut.onReady("title", () => {
        gsap.from(".title", { y: 80, autoAlpha: 0, duration: 0.8, ease: "back.out(1.6)" });
        // Exit runs 2.4s after mount; duration 0.6s; finishes at scene end (3.0s).
        gsap.to(".title", { y: -40, autoAlpha: 0, duration: 0.6, delay: 2.4, ease: "power2.in" });
      });
    </script>
  </template>
</gm-scene>
```

**B — Overlap the next scene.** Make the next scene start before
the current one ends so its entrance bleeds into the still-visible
state. Each scene only writes its own entrance; the cross-fade
emerges from the overlap window. Often the cleanest authoring shape
for compositions with many beats.

```html
<gm-scene id="title"  start="0.4s" duration="3.1s">...</gm-scene>
<gm-scene id="payoff" start="3.1s" duration="2.9s">...</gm-scene>
<!-- The two scenes coexist from 3.1s to 3.5s.
     During that window, payoff fades in while title is still mounted. -->
```

**C — Make the scene the terminal endcard.** If a scene is the
last beat in the timeline, holding it static through its end is
fine — there's nothing to cut to. `gamut verify` exempts the
terminal scene from the `scene-hard-cut` warning.

`gamut verify` flags scenes with no motion in their last 200ms AND
no overlapping follower as `scene-hard-cut` with an actionable
message naming the scene id.

## Playhead vs GSAP's wall clock

GSAP's `gsap.timeline()` and `gsap.to()` run off `requestAnimationFrame`
wall-clock time. **Once you kick off a tween in `onReady`, it
free-runs.** If the gamut player pauses, the DOM keeps animating;
if the user scrubs back, GSAP does not rewind. For short entry
animations (titles, kickers, fades under ~1s) this is fine — the
overlap with playback is short enough that drift is invisible.

For motion that must stay locked to the playhead — anything that
scrubs, or anything longer than a beat — drive the timeline
manually off `gamut.onTick`:

```html
<script>
  gamut.onReady("hero", ({ durationFrames, fps }) => {
    // Build it paused. Don't .play().
    const tl = gsap.timeline({ paused: true });
    tl.from(".hero",   { y: 40, autoAlpha: 0, duration: 0.5 }, 0)
      .from(".sub",    { y: 20, autoAlpha: 0, duration: 0.4 }, 0.2)
      .from(".kicker", { scale: 0.9, autoAlpha: 0, duration: 0.4 }, 0.4);

    const totalSec = durationFrames / fps;
    gamut.onTick("hero", ({ frame }) => {
      tl.progress((frame / fps) / totalSec);
    });
  });
</script>
```

That pattern — **paused timeline + `tl.progress()` driven by the
tick frame** — gives you scrub-safe, pause-safe motion that
stays locked to the gamut transport.

## When to drop into raw GSAP free-run

- Typewriter / character reveal (needs `TextPlugin`).
- Audio-reactive bars / pulses driven by pre-extracted RMS data.
- Particle systems, canvas / WebGL.
- Anything short enough that wall-clock drift is invisible.

## GSAP fundamentals

The full reference is upstream. The minimum to write good tweens:

### Methods

- `gsap.to(targets, vars)` — animate from current state to `vars`.
- `gsap.from(targets, vars)` — animate from `vars` to current
  state. **Entrances.**
- `gsap.fromTo(targets, fromVars, toVars)` — explicit both ends.
- `gsap.set(targets, vars)` — apply immediately, duration 0.

Property names are **camelCase** (`backgroundColor`, `rotationX`).

### Common vars

- `duration` — seconds (default 0.5).
- `delay` — seconds before start.
- `ease` — `"power2.out"` (default), `"back.out(1.7)"`,
  `"elastic.out(1, 0.3)"`, `"sine.inOut"`, `"none"`.
- `stagger` — `0.1` or `{ amount: 0.3, from: "center" }`.
- `repeat`, `yoyo` — repeat with direction reversal.

### Transform aliases — use these, not raw `transform`

| GSAP property               | Equivalent          |
|-----------------------------|---------------------|
| `x`, `y`, `z`               | translateX/Y/Z (px) |
| `xPercent`, `yPercent`      | translateX/Y in %   |
| `scale`, `scaleX`, `scaleY` | scale               |
| `rotation`                  | rotate (deg)        |
| `transformOrigin`           | transform-origin    |
| `autoAlpha`                 | opacity + visibility|

`autoAlpha` is preferred over raw `opacity` — at 0 it also sets
`visibility: hidden`, so the element stops capturing pointer
events.

### Easing — pedagogy

See [motion-principles.md](./motion-principles.md) "Easing is
emotion." Direction matters:

- `.out` for entries (starts fast, decelerates — feels responsive).
- `.in` for exits (starts slow, accelerates away).
- `.inOut` for elements moving between positions.

### Timelines

A single scene typically uses one timeline. Build it inside
`onReady`:

```js
const tl = gsap.timeline({ defaults: { duration: 0.5, ease: "power2.out" } });
tl.from(".hero", { y: 40, autoAlpha: 0 })
  .from(".sub", { y: 20, autoAlpha: 0 }, "<0.2")
  .from(".kicker", { scale: 0.9, autoAlpha: 0 }, "<");
```

Position parameter cheatsheet:

- `1` — absolute, at 1s.
- `"+=0.5"` — 0.5s after the previous tween ends.
- `"<"` — same start as the previous tween.
- `"<0.2"` — 0.2s after the previous tween starts.

### Stagger

```js
gsap.from(".card", {
  y: 30, autoAlpha: 0, duration: 0.5,
  stagger: { amount: 0.4, from: "start" }
});
```

`amount` distributes the total stagger window across the matched
set. `from: "center"` / `"edges"` / `"random"` change the order.

### Performance

- Animate transforms + opacity. They stay on the compositor.
- Avoid `width`, `height`, `top`, `left` — they re-layout.
- `will-change: transform` ONLY on elements that animate.
- For continuous-input loops (mousemove, audio data) use
  `gsap.quickTo()`, not many `gsap.to()` calls.

### Cleanup

The scene's DOM is removed when the playhead leaves its window, so
short tweens self-clean. For long-lived constructs (intervals,
`gsap.quickTo` setters, audio analysers, WebGL contexts) tear
them down in a return from your `onReady` callback — the runtime
calls it on unmount:

```js
gamut.onReady("hero", () => {
  const setX = gsap.quickTo(".cursor", "x", { duration: 0.3 });
  const onMove = (e) => setX(e.clientX);
  window.addEventListener("pointermove", onMove);
  return () => window.removeEventListener("pointermove", onMove);
});
```

## Do not

- Animate layout properties when transforms suffice.
- Skip cleanup — long-lived tweens / listeners need teardown.
- Use `setTimeout` to sequence animations. Use a timeline.
- Trust the wall clock for sync — drive the timeline off
  `gamut.onTick` when scrub or pause behavior matters.
