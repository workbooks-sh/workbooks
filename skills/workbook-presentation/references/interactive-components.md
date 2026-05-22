# Interactive components in presentations

Workbooks can embed anything the runtime supports — `<wb-cell>`,
`<Stage>`, charts that recompute, even an embedded agent. Used
right, this is what separates a workbook presentation from a
PowerPoint export. Used wrong, it's a pacing disaster.

---

## The single most important rule

**Always have a static fallback for every interactive slide.**

A demo that fails on stage is a slide. A demo that fails on stage
with no fallback is a 60-second silence.

Concretely: every `<Slide kind="demo">` declares a `fallback=`
attribute pointing at a screenshot or short video. If the
interactive content takes longer than 500ms to mount, the fallback
shows; the presenter can swipe-up to switch to live.

```html
<Slide kind="demo" fallback="demo-screenshot.png">
  <Stage wraps="../demo/dist/demo.html" />
</Slide>
```

The fallback is also what screen-recording captures. Workbook
presentations are often recorded and embedded later — a recording
of a demo slide should always show the demo (live or fallback),
never a spinner.

---

## When to embed something interactive

Good reasons:

- **The demo IS the point.** Product launches, tool unveilings.
  Showing the thing matters more than describing it.
- **Audience-driven branching.** "I'll show you what happens with
  X" and you toggle a value. Works for tech talks where the
  audience has opinions.
- **Live data that has to be live.** Showing today's metrics, a
  Kubernetes cluster's current state, a stock chart. (Verify the
  data source is reliable — offline kills you.)
- **A calculator the audience asks for.** "How much does this save
  you? Type your numbers in." Powerful in sales decks.

Bad reasons:

- **"Wow factor."** If the interaction doesn't carry narrative
  weight, it's distracting. Audiences want signal, not novelty.
- **Replacing words you should say.** If the slide's point can be
  made by saying it, say it. Interactivity is for content the
  audience needs to see actively, not passively.
- **Showing off the tooling.** Resist. The audience doesn't care
  that the chart is reactive; they care what it shows.

---

## What to embed and how

### `<wb-cell>` (single cell)

Use for: small computations the audience watches the presenter
trigger. Tunable inputs, "what if we change this number" moments.

```html
<Slide kind="demo" fallback="cell-screenshot.png">
  <h2>If we increased pricing 20%…</h2>
  <wb-cell language="chart">
    { "mark": "bar", "encoding": { "x": "tier", "y": "arr" } }
  </wb-cell>
  <Input bind="pricingMultiplier" min={1} max={2} step={0.1} />
</Slide>
```

**Rules:**
- Keep the cell cheap — re-evaluation must feel instant
  (≤200ms). If it's slower, pre-compute and toggle states.
- One cell per slide. Multiple interactive cells split the
  audience's attention.

### `<Stage>` (embedded workbook)

Use for: full product demos. The stage wraps another workbook in
an iframe with optional side panels (effects / chat / terminal).

```html
<Slide kind="demo" fallback="stage-video.mp4">
  <Stage
    wraps="../demo/dist/demo.html"
    panels={{ right: "chat" }}
  />
</Slide>
```

**Rules:**
- The wrapped workbook MUST be a built artifact (not a dev URL).
  Cross-origin / auth flakiness will burn you on stage.
- Pre-warm the iframe — preload the wrapped workbook's `.html`
  bytes at deck-load time so the demo slide's first transition
  isn't a fetch.
- If the wrapped workbook is heavy, consider a 2-state slide: a
  static screenshot first, presenter taps to swap to the live
  Stage.

### `<wb-agent>` (embedded agent)

Use for: Q&A slides where the audience types and the agent
answers using the deck's own content. Or presenter co-pilot in
presenter-mode-only.

```html
<Slide kind="qa">
  <h1>Ask the deck</h1>
  <wb-agent
    system="You answer questions about this deck. Quote slide numbers when relevant."
    context-from="deck"
  />
</Slide>
```

**Rules:**
- Set explicit context (the deck content). Don't let the agent
  guess.
- Cap response length to ~3 short paragraphs — long answers
  break the room's attention.
- Pre-warm the agent — first response in the session takes
  longer; trigger a dummy "hello" at deck load.
- Have a backup: a `qa` slide with a static thank-you in case
  the agent provider is down.

### `<Chart>` with live data

Use for: dashboards, real-time monitoring talks.

**Rules:**
- The data source must be cached locally at deck-build time so
  the slide renders something even offline.
- Refresh interval ≥ 5s. Don't make the chart twitch.
- Always annotate the takeaway in the slide title — live data
  changes, but the point of the slide shouldn't.

---

## The pacing rule

**Never auto-advance.** Presenter triggers every transition.

This includes:
- Slide-to-slide navigation
- Reveals within a slide (progressive reveal of points)
- Demo state changes (clicking through the demo)
- Agent responses (presenter approves before sending)

The audience trusts the presenter to control pace. Auto-advance
breaks that contract.

---

## The "is it interactive?" affordance

Audiences can't tell from across the room whether a slide is
interactive. The runtime ships a small ▶ icon in the bottom-right
of any slide with `kind="demo"` to signal "the presenter can
interact with this".

For non-`demo` slides that happen to have an embedded cell, add
the affordance explicitly:

```html
<Slide kind="content" interactive>
  <h2>Adjust the multiplier</h2>
  <wb-cell ... />
</Slide>
```

`interactive` adds the visual marker without changing the slide's
default styling.

---

## Performance budget

Interactive slides should mount in under 500ms after they become
the current slide. The runtime defers the mount until the slide is
about to be shown (1 slide ahead in the queue), so the cost happens
during the transition from the previous slide.

If a slide can't mount in 500ms:
- Show the static fallback first, swap to live on presenter tap.
- Or pre-compute the result and embed it inline instead of
  computing live.

Heavy `<Stage>` slides (wrapping a wasm-heavy workbook) often need
the two-state pattern. Cheap `<wb-cell>` slides usually don't.

---

## Recording considerations

Workbook presentations are often:
- Screen-recorded during a live talk for later upload
- Auto-thumbnailed by the hosted viewer
- Embedded in marketing pages as a "see the deck"

For each:
- **Live recording** — the fallback must look good if the live
  thing fails. Test by toggling the fallback on every demo slide
  and watching the deck end-to-end.
- **Auto-thumbnail** — the first slide must work without
  JavaScript (the thumbnailer often runs headless). Avoid heavy
  client-side rendering on the title slide.
- **Embedded view** — interactive slides degrade gracefully in
  iframes with restricted permissions. Avoid `<wb-agent>` slides
  in marketing-page embeds (they'll prompt for API keys).
