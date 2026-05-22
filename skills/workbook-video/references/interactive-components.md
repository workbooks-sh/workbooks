# Interactive components in video workbooks

A video workbook is a gamut composition that ships in the browser.
Because the player is the browser, the chrome around the timeline is
configurable and the scenes themselves can carry live interactive
content. Used right, this is what separates a workbook video from a
YouTube embed. Used wrong, it confuses the viewer and breaks the
recording.

This doc covers two distinct domains: **player chrome decisions**
(the surface the viewer drives) and **embedded interactive scenes**
(interactivity inside the timeline).

The canonical format reference is `references/gamut.md`. Read that
first if you haven't — every code example below assumes the gamut
model (single `.html` file, `<gm-*>` elements, scene content inside
`<template>`, all gm-* elements have explicit closing tags).

---

## The single most important rule

**Every interactive scene degrades to a static fallback.**

A video that depends on JavaScript working perfectly is a video
that breaks on:

- Auto-thumbnail capture (often headless, often blocks JS).
- Embedded views on third-party pages (restricted permissions).
- Recording the workbook to MP4 for upload.
- Recipient browsers with extensions that block third-party state.

Concretely: every interactive scene renders a usable poster
frame from its own HTML before any JavaScript runs. Author the
scene so the markup alone tells the story; let GSAP, fetch, and
event listeners enhance the result, not produce it. Burn captions
as text overlay so they survive a recording even if a live caption
fetch hiccups.

```html
<gm-scene id="live-chart" start="6s" duration="20s">
  <template>
    <div class="live-chart">
      <img class="poster" src="./assets/chart-poster.png" alt="Q3 chart">
      <svg class="live" aria-hidden="true"></svg>
    </div>
    <script>
      gamut.onReady("live-chart", async (ctx) => {
        const root = ctx.root;
        try {
          const data = await fetch("./assets/q3.json").then(r => r.json());
          drawChart(root.querySelector(".live"), data);
          root.querySelector(".poster").style.opacity = 0;
        } catch {
          // Poster stays visible; that's the fallback.
        }
      });
    </script>
  </template>
</gm-scene>
```

The poster `<img>` is part of the scene's HTML, so it paints
immediately on mount. The live layer overlays once data resolves.
If the fetch fails, the static poster is what records and what
thumbnails capture.

---

## Domain 1: Player chrome decisions

`<gm-doc>` orchestrates parse, resolve, and playback. Player chrome
(transport bar, scrub bar, captions toggle, fullscreen button) is
controlled either by attributes on `<gm-doc>` or by the host page
mounting the workbook. Decide chrome behaviour deliberately —
defaults are sensible but rarely optimal for a specific deliverable.

### Autoplay vs. click-to-play vs. scrub-only

| Decision           | Use for                                                |
| ------------------ | ------------------------------------------------------ |
| **Auto-play once** | Social ads (the link page should play immediately), brand spots embedded on a homepage hero. |
| **Click-to-play**  | Sales pitch videos — the recipient is reading email and shouldn't be audio-bombed. |
| **Scrub-only**     | Product demos that double as documentation; viewers want to find a specific feature, not watch linearly. |

The host page passes these as attributes on `<gm-doc>`:

```html
<gm-doc fps="30" resolution="1920x1080" aspect="16:9"
        autoplay="off" start-mode="scrub">
  <!-- ... -->
</gm-doc>
```

`autoplay="off"` overrides the runtime default. `start-mode="scrub"`
shows the timeline scrubbed-out, ready for the viewer to drag.

### Captions toggle default

The runtime ships a `CC` toggle in the transport bar. Decide the
default state per composition:

| Default state           | Use for                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **On**                  | Social videos, talking-head clips, any video with VO. >85% of social viewing is muted.   |
| **Off, easy to enable** | Brand spots without VO, animated explainers where captions would compete with motion.    |
| **Forced on, no toggle**| Accessibility-first deliverables (corporate, healthcare, government).                    |

Captions are themselves a `<gm-scene>` that renders text from a
transcript asset. Lock or unlock the toggle via a `data-captions-*`
attribute on `<gm-doc>` (your host page reads it and configures the
caption scene accordingly):

```html
<gm-doc fps="30" resolution="1920x1080" aspect="16:9"
        data-captions-default="on" data-captions-lockable="false">
  <!-- ... -->
</gm-doc>
```

### Fullscreen affordance

Most viewers want fullscreen on long-form content (>2 min) and
don't need it on short-form. The transport's fullscreen button
appears by default; hide it on social-ad-style short content where
the viewer is scrolling vertically anyway:

```html
<gm-doc fps="30" resolution="1080x1920" aspect="9:16"
        data-controls-fullscreen="false">
  <!-- ... -->
</gm-doc>
```

### Chapter markers (sections of long videos)

For videos > 2 minutes, declare chapter markers as a metadata
sidecar inside `<gm-doc>` head matter, or as a JSON asset the host
page reads to render ticks on the scrub bar. A clean pattern is a
small chapters asset:

```html
<gm-asset id="chapters" kind="json" src="./assets/chapters.json"></gm-asset>
```

```json
[
  { "id": "intro",   "at": "0s",   "label": "Intro" },
  { "id": "problem", "at": "20s",  "label": "The problem" },
  { "id": "demo",    "at": "60s",  "label": "Live demo" },
  { "id": "recap",   "at": "200s", "label": "Recap" }
]
```

**Rules:**

- ≤ 7 chapters. More turns the scrub bar into a confusing density
  of ticks.
- Each chapter ≥ 15 seconds. Shorter is noise.
- Skip chapters entirely for videos < 2 minutes.

### Keyboard nav defaults

The runtime ships Space/K (play-pause), Arrow/J-L (seek 1s), `[`
and `]` (jump chapter), Home/End (jump to bounds), `f` (fullscreen),
`m` (mute). Override only when the workbook is embedded in a page
with conflicting keyboard handlers — most override cases are
subtractive (disable Arrow keys when the workbook lives in a docs
page that uses Arrow for navigation).

```html
<gm-doc fps="30" resolution="1920x1080" aspect="16:9"
        data-keyboard-disable="ArrowLeft,ArrowRight">
  <!-- ... -->
</gm-doc>
```

---

## Domain 2: Embedded interactive scenes

A `<gm-scene>` can mount live interactive content — clickable
hotspots, branching paths, embedded charts the viewer scrubs
independently, scenes that read query parameters or live data.
Because scenes are just HTML inside a `<template>`, "interactive"
just means the scene's inline JS attaches event listeners and
reacts. Use sparingly; most scenes should be timeline-only.

### When to embed something interactive

Good reasons:

- **The interactivity IS the point.** A product demo where the
  viewer can click to see different states. A "calculate your
  savings" inline form in a sales pitch video.
- **Audience-driven branching.** Choose-your-demo-path: the viewer
  picks which feature to deep-dive into; the timeline jumps to the
  matching scene.
- **Scrubable embedded chart.** A static frame holds the story; an
  embedded chart the viewer can scrub gives them the data
  underneath.
- **Live data the viewer expects to be live.** A "current status"
  panel at the close of a quarterly update video.

Bad reasons:

- **"It's interactive because it can be."** If the viewer doesn't
  do anything with it, it's a complexity tax for no payoff.
- **Replacing motion you should design.** Interactivity is not a
  substitute for designing a beat.
- **Showing off the runtime.** The viewer doesn't care that the
  panel is reactive; they care what it shows.

### Pattern 1 — Hotspot scene with reveal on hover

A scene that pauses the timeline when the viewer hovers a hotspot,
surfacing details. Use for product demos where each hotspot
explains a UI affordance.

```html
<gm-scene id="hotspots" start="8s" duration="12s">
  <template>
    <div class="hotspot-overlay">
      <button class="hotspot" data-hotspot="search" style="top: 12%; left: 22%">
        <span class="dot"></span>
        <span class="label">Cmd-K search — works on any field</span>
      </button>
      <button class="hotspot" data-hotspot="filters" style="top: 38%; left: 64%">
        <span class="dot"></span>
        <span class="label">Saved filters persist across sessions</span>
      </button>
    </div>
    <script>
      gamut.onReady("hotspots", (ctx) => {
        const root = ctx.root;
        root.querySelectorAll(".hotspot").forEach(btn => {
          btn.addEventListener("mouseenter", () => ctx.pause());
          btn.addEventListener("mouseleave", () => ctx.resume());
        });
      });
    </script>
  </template>
</gm-scene>
```

**Rules:**

- ≤ 5 hotspots per scene. More overwhelms.
- Hotspots stay visible (with their dot) even when no hover — the
  affordance must telegraph itself.
- The timeline pauses on hover and resumes on leave; do NOT trap
  the viewer in a hotspot they didn't intend.

### Pattern 2 — Branching path ("choose your demo")

The timeline forks. After a setup scene, the viewer picks one of N
paths and the playhead seeks to the matching scene's `start`. All
paths converge at a final scene so no viewer feels they missed
something.

```html
<gm-timeline id="main" duration="120s">
  <gm-track id="content" z="0">
    <gm-scene id="setup" start="0s" duration="20s">
      <template>
        <!-- setup content -->
      </template>
    </gm-scene>

    <gm-scene id="picker" start="20s" duration="6s">
      <template>
        <div class="picker">
          <h2>Where would you like to go?</h2>
          <button data-goto="40s">Show me the data view</button>
          <button data-goto="80s">Show me the agent view</button>
          <button data-goto="100s">Skip — go to recap</button>
        </div>
        <script>
          gamut.onReady("picker", (ctx) => {
            ctx.pause();
            const root = ctx.root;
            const timer = setTimeout(() => ctx.seek("40s"), 6000);
            root.querySelectorAll("[data-goto]").forEach(btn => {
              btn.addEventListener("click", () => {
                clearTimeout(timer);
                ctx.seek(btn.dataset.goto);
                ctx.resume();
              });
            });
          });
        </script>
      </template>
    </gm-scene>

    <gm-scene id="data-branch"  start="40s"  duration="40s"><template><!-- ... --></template></gm-scene>
    <gm-scene id="agent-branch" start="80s"  duration="20s"><template><!-- ... --></template></gm-scene>
    <gm-scene id="recap"        start="100s" duration="20s"><template><!-- ... --></template></gm-scene>
  </gm-track>
</gm-timeline>
```

**Rules:**

- Branches converge. All branches should lead to the same closing
  scene; otherwise the viewer wonders if they missed something.
- ≤ 3 branches at any fork. More is paradox of choice.
- Default-pick after 6 seconds if the viewer doesn't choose, so the
  video can be left alone and still play to the end.

### Pattern 3 — Scrubable embedded chart

A still frame holds the headline ("Q3 revenue grew 3.2×") while an
embedded chart pinned to the lower third lets the viewer scrub
through the quarterly trajectory independently. Touching the chart
pauses the video; tapping outside resumes.

```html
<gm-scene id="claim" start="30s" duration="15s">
  <template>
    <div class="claim">
      <h1 class="headline">Q3: 3.2× revenue growth</h1>
      <div class="chart-region">
        <canvas class="chart"></canvas>
        <input class="scrub" type="range" min="0" max="11" value="11" aria-label="Scrub quarter">
      </div>
    </div>
    <script>
      gamut.onReady("claim", async (ctx) => {
        const root = ctx.root;
        const data = await fetch("./assets/quarters.json").then(r => r.json());
        const canvas = root.querySelector(".chart");
        const scrub = root.querySelector(".scrub");
        const region = root.querySelector(".chart-region");
        drawChart(canvas, data, 11);
        region.addEventListener("pointerdown", () => ctx.pause());
        scrub.addEventListener("input", () => drawChart(canvas, data, +scrub.value));
        root.addEventListener("pointerleave", () => ctx.resume());
      });
    </script>
  </template>
</gm-scene>
```

The chart is its own scrub surface; touching it pauses the video
and hands control to the input. The headline is static markup, so
it survives a recording even if the chart never mounts.

### Pattern 4 — Inline live-data callout

A scene that reads a URL query parameter and fills in a personalized
callout — for instance, "for a team your size, you save…" in a
sales pitch video that picks up `?team=24` from the link.

```html
<gm-scene id="callout" start="45s" duration="8s">
  <template>
    <div class="callout">
      <h3>For a team your size…</h3>
      <p class="value" data-default="$748,800/year">$748,800/year</p>
    </div>
    <script>
      gamut.onReady("callout", (ctx) => {
        const el = ctx.root.querySelector(".value");
        const teamSize = +new URLSearchParams(location.search).get("team") || 24;
        const annual = teamSize * 6 * 52 * 80;
        el.textContent = `$${annual.toLocaleString()}/year`;
        gsap.from(el, { opacity: 0, y: 16, duration: 0.5 });
      });
    </script>
  </template>
</gm-scene>
```

**Rules:**

- One live-data block per scene. Multiple split attention.
- The block must resolve in < 300ms. Slower than that and the
  scene's pacing breaks.
- Always include a sensible default in the markup — the `data-default`
  pattern above keeps the recording / thumbnail readable even when
  the query param is missing or the JS never runs.

### Pattern 5 — Composed scenes that share state

Two scenes on adjacent tracks that listen to the same custom
events — useful when an interactive element in one track needs to
influence motion in another. The shared bus is just the DOM:
dispatch events on `document` or on the `<gm-doc>` element.

```html
<gm-scene id="controls" start="50s" duration="10s">
  <template>
    <div class="controls">
      <button data-tint="warm">Warm</button>
      <button data-tint="cool">Cool</button>
    </div>
    <script>
      gamut.onReady("controls", (ctx) => {
        ctx.root.querySelectorAll("[data-tint]").forEach(btn => {
          btn.addEventListener("click", () => {
            document.dispatchEvent(new CustomEvent("demo:tint", { detail: btn.dataset.tint }));
          });
        });
      });
    </script>
  </template>
</gm-scene>

<gm-scene id="tinted-bg" start="50s" duration="10s">
  <template>
    <div class="bg"></div>
    <script>
      gamut.onReady("tinted-bg", (ctx) => {
        const bg = ctx.root.querySelector(".bg");
        document.addEventListener("demo:tint", (e) => {
          gsap.to(bg, { backgroundColor: e.detail === "warm" ? "#f4a261" : "#2a9d8f", duration: 0.6 });
        });
      });
    </script>
  </template>
</gm-scene>
```

Keep the event names project-scoped (`demo:*`, not `tint`) so they
don't collide with built-in DOM events or with other scenes.

---

## The fallback principle (re-stated)

Every interactive scene is required to provide:

1. **Static markup that paints on mount.** The poster `<img>`, the
   default callout text, the chart's headline — these are all part
   of the scene's HTML inside `<template>`. The runtime clones the
   template into the viewport; the markup is on-screen before any
   inline `<script>` runs.
2. **A burned-in caption layer.** If the scene has captions, render
   them as static text inside the template. Don't rely on a live
   caption fetch for the fallback path.
3. **A meaningful first paint for thumbnailing.** The
   auto-thumbnailer captures the first painted frame of the first
   scene. Make sure that frame is the poster, not a spinner.

The fallback is also what screen-recording captures. Workbook
videos are often re-recorded for distribution platforms — a
recording of an interactive scene should always show the scene
(live or fallback), never a spinner or a blank frame.

---

## Performance budget

Scenes mount when the playhead enters their `[start, start+duration)`
window. The runtime fires `hf:ready` once the scene's container is
in the viewport; that's when GSAP timelines, fetch calls, and event
listeners should attach. Aim for first interaction-ready in under
500 ms after `hf:ready`.

If a scene can't be live-ready in 500 ms:

- Render the static poster as part of the template; swap to the
  live layer once it settles.
- Or pre-compute the result at build time and embed it inline as
  static content instead.

Heavy scenes (large dataset fetches, third-party widgets) need the
two-layer pattern. Cheap interactive scenes usually don't.

---

## Recording considerations

Video workbooks get re-recorded for distribution. Plan for it:

- **Live screen recording.** The fallback must look good if the
  live thing fails. Test by short-circuiting the inline `<script>`
  on every interactive scene and watching the composition
  end-to-end.
- **Auto-thumbnail.** The first frame of the first scene must render
  without JavaScript. Avoid heavy client-side rendering on the
  title scene.
- **Embedded view.** Interactive scenes degrade gracefully in
  iframes with restricted permissions. Avoid scenes that depend on
  third-party cookies or popup windows when the workbook is
  embedded.
- **Export to MP4 (eventual).** When render-to-MP4 ships, it will
  rasterize whatever the page paints frame by frame. Anything
  interactive needs its non-interactive frame to look like the
  intended shot.

---

## Common failure modes

- **Interactive scene with no static markup.** Looks fine in dev,
  breaks on recording.
- **Hotspots so subtle the viewer doesn't see them.** The
  affordance has to be obvious from across the room.
- **Branching with no convergence.** Viewer wonders what they
  missed. All branches converge on a single closing scene.
- **Live-data block that takes > 300 ms to resolve.** Breaks the
  composition's pacing — feels like a frozen frame. Pre-compute or
  show the default text immediately and update in place.
- **Cross-scene events without a project-scoped name.** A scene
  dispatching `click` or `change` on `document` will collide with
  built-in handlers. Always namespace (`demo:tint`, `qa:select`).
