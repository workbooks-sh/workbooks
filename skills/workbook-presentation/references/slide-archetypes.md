# Slide archetypes

Every slide should match one of these archetypes. The
`<Slide kind="…">` runtime applies the right defaults
(typography, layout, whitespace) automatically — you just
declare what KIND of slide it is.

Mixing archetypes within a single slide is the most common
design mistake. A slide is one thing.

---

## `title` — deck open

**Purpose:** Establish what this deck is and who it's by.

**Contents:** Deck title (display font, large), subtitle or context
line, optional date / venue / author footer.

**Rules:** No body content. No bullets. No logo wall.

**Example:**

```html
<Slide kind="title">
  <h1>Our 2026 Story</h1>
  <p class="subtitle">Q3 review · prepared for the board</p>
  <p class="footer">10 November 2026 · Shane Murphy</p>
</Slide>
```

**Use when:** First slide of any deck. Once per deck.

---

## `section` — section break

**Purpose:** Reset the audience's attention between major arcs.

**Contents:** Section name only. Big. Centered. Often on a colored
or full-bleed background.

**Rules:** Audience should feel a break. Use the dominant color or
a contrasting full-bleed image. No body text.

**Example:**

```html
<Slide kind="section">
  <h1>Where we are</h1>
</Slide>
```

**Use when:** Transitioning between named arcs. One per section
(usually 3-5 per deck for a 30-min talk).

---

## `content` — workhorse slide

**Purpose:** Make one point. The 80% of your deck.

**Contents:** Slide title (the point in one sentence), supporting
visual or body text, ≤6 lines × 6 words.

**Rules:** ONE idea. The title is the idea, the body shows it.
If you find yourself writing two paragraphs, split into two
slides.

**Example:**

```html
<Slide kind="content">
  <h2>Customers don't want more features.</h2>
  <p>They want the features they have to work without thinking.</p>
</Slide>
```

**Use when:** Default slide kind. When in doubt, this.

---

## `stat` — one big number

**Purpose:** Land a single number with maximum impact.

**Contents:** ONE giant number (display font, 120-180pt), one
sentence below explaining what the number is.

**Rules:** Just the number. No comparison, no breakdown, no chart
beside it. If you need to compare, use `comparison`.

**Example:**

```html
<Slide kind="stat">
  <p class="huge">3.2×</p>
  <p>revenue growth, quarter over quarter</p>
</Slide>
```

**Use when:** You have a number that deserves its own slide. Use
sparingly — 1-3 per deck. Overuse cheapens each one.

---

## `quote` — single voice

**Purpose:** Use someone else's words to make your point.

**Contents:** The quote (large, serif if the rest is sans), the
attribution (small, below), optional photo of the speaker.

**Rules:** No commentary on the quote — the quote IS the
commentary. The next slide is where you respond to it.

**Example:**

```html
<Slide kind="quote">
  <blockquote>The best way to predict the future is to invent it.</blockquote>
  <cite>— Alan Kay</cite>
</Slide>
```

**Use when:** Customer testimonial, industry voice, historical
anchor. Once or twice per deck.

---

## `image` / `full-bleed` — visual punctuation

**Purpose:** A moment of visual impact. Reset attention. Set
emotional tone.

**Contents:** One image, edge to edge, no chrome. Optional title
overlay (bottom-left or centered, with backdrop for readability).

**Rules:** Image must be high-resolution (3840×2160 minimum to
look crisp on 4K projectors). No stock-photo cliché.

**Example:**

```html
<Slide kind="full-bleed" src="hero.jpg" alt="Empty office at dawn">
  <h2 class="overlay-bottom-left">Monday, 6am</h2>
</Slide>
```

**Use when:** Scene-setter, section opener, emotional anchor.
2-5 per deck depending on tone.

---

## `comparison` — side by side

**Purpose:** Show contrast. Before/after, us/them, with/without.

**Contents:** Two (occasionally three) columns. Each column has a
heading and short content. Visual separator between them.

**Rules:** Columns must be comparable on the SAME axes. Don't
compare apples and oranges. Use the same visual weight on both
sides; if you bias one column visually, the audience reads bias.

**Example:**

```html
<Slide kind="comparison">
  <h2>Before / after</h2>
  <div class="col">
    <h3>Before</h3>
    <p>3.2s page load · 14% conversion</p>
  </div>
  <div class="col">
    <h3>After</h3>
    <p>0.6s page load · 31% conversion</p>
  </div>
</Slide>
```

**Use when:** Highlighting a change, positioning vs. competitors,
showing before/after results.

---

## `process` — sequence

**Purpose:** Walk through a sequence of steps.

**Contents:** 3-5 steps, each with a number/icon, name, and one-line
description. Connected by arrows or progression.

**Rules:** No more than 5 steps. If you have 7, you have two
slides. Each step name is 1-3 words; the description is one short
sentence.

**Example:**

```html
<Slide kind="process">
  <h2>How it works</h2>
  <div class="wb-slide-flow">
    <div><b>Author</b> · write your workbook</div>
    <div><b>Build</b> · CLI compiles to one HTML file</div>
    <div><b>Share</b> · email, publish, host anywhere</div>
  </div>
</Slide>
```

The CSS counter on `.wb-slide-flow > *` numbers each step. `<ol><li>`
also works (the theme suppresses the browser's default numbers so
the counter doesn't double).

**Use when:** Explaining a workflow, an architecture flow, a sales
funnel. Once or twice per deck.

---

## `code` — code on slide

**Purpose:** Show code. Specifically. Not a long example, a
focused snippet.

**Contents:** Syntax-highlighted code block. Language indicator.
Optional comment-line callouts for what to look at.

**Rules:**
- Max 12 lines. Anything longer is for the docs, not the slide.
- Font: monospace, 28pt minimum.
- Use a high-contrast syntax theme (the runtime ships one tuned
  for projection).
- The slide title says what the code DOES, not "code example".
- If you need to talk about a specific line, highlight it visually
  (bg color or arrow).

**Example:**

```html
<Slide kind="code" lang="typescript">
  <h2>The whole API surface, today</h2>
  <pre><code>
const wb = await connections.get("openai");
const res = await wb.fetch("/v1/chat/completions", {
  method: "POST",
  body: JSON.stringify({ model: "gpt-4o", messages }),
});
  </code></pre>
</Slide>
```

**Use when:** Tech talks, API demos. Sparingly in non-tech decks
(when the code itself is the surprise — "look how short this is").

---

## `chart` — data viz on a slide

**Purpose:** Show data. The slide's title carries the takeaway; the
chart proves it.

**Contents:** Title (the takeaway, one sentence), the chart (fills
most of the canvas), optional caption / source line below.

**Rules:**
- **The title IS the conclusion.** "Q3 revenue grew 32% YoY", not
  "Q3 Revenue". If the audience has to read the chart to know what
  it shows, the slide failed.
- **Annotate the data point** you want them to see (highlight bar,
  callout arrow, labeled point). Don't make them hunt.
- **Drop chart-junk** — no 3D, no gradient fills, no decorative
  gridlines.
- **One color emphasis.** If 5 lines are on the chart, 1 is in the
  accent color and 4 are muted neutrals.
- **Axis labels readable from the back** (24pt+).
- **Cite the source** in the caption — every chart, every time.

**Example:**

```html
<Slide kind="chart">
  <h2>Q3 revenue grew 3.2× YoY</h2>
  <figure class="wb-chart">
    <!-- Static SVG, server-rendered chart image, or live wb-cell:
         <wb-cell language="chart">{...vega spec...}</wb-cell> -->
    <img src="./charts/q3-revenue.svg" alt="Bar chart, 2025 vs 2026 Q3" />
    <figcaption>Internal accounting · all amounts USD · charted 2026-10-31</figcaption>
  </figure>
</Slide>
```

For live / interactive charts that the presenter manipulates on
stage, also set `interactive` on the Slide and follow the rules in
[interactive-components.md](interactive-components.md).

**Use when:** You have data to land. 2-5 per data-driven deck;
avoid if the data is incidental — a stat slide hits harder for a
single number.

---

## `demo` — live or recorded demo

**Purpose:** Show the product or system in motion.

**Contents:** Either an embedded interactive (a `<wb-cell>`, a
`<Stage>` wrapping the real product) OR a video file OR a
high-res screenshot.

**Rules:**
- ALWAYS have a fallback. Embed an `<img>` or `<video>` static
  fallback even if the live demo is the primary content. Demos
  fail.
- Visually mark "this is interactive" so the presenter knows
  where to click and the audience knows it's not just a picture.
  Runtime ships a small ▶ affordance for `<Slide kind="demo">`.
- Never auto-play. Presenter triggers.
- See [interactive-components.md](interactive-components.md) for
  embedding rules.

**Example:**

```html
<Slide kind="demo" fallback="demo-screenshot.png">
  <h2>Three clicks to a workbook</h2>
  <Stage wraps="../demo-project/dist/demo.html" panels={{right:"chat"}} />
</Slide>
```

**Use when:** Product launches, tool demonstrations, "let me show
you" moments. 1-3 per deck.

---

## `qa` — Q&A / closing

**Purpose:** Signal end of presentation, invite questions.

**Contents:** "Questions?" or "Thank you." Optional contact info
(slack handle, email, repo URL).

**Rules:** No new content. No "any final thoughts" essay. The
closing image of the previous slide should still be on the
audience's mind.

**Example:**

```html
<Slide kind="qa">
  <h1>Questions?</h1>
  <p>shane@shinyobjectz.com · github.com/workbooks-sh</p>
</Slide>
```

**Use when:** Last slide of every deck.

---

## `backup` / `appendix` — supporting slides

**Purpose:** Slides you DON'T present but want available for
deep-dive Q&A or post-meeting reference.

**Contents:** Anything that didn't make the main flow — detailed
charts, methodology, FAQs, deeper architecture diagrams.

**Rules:** Tagged as `kind="backup"`; the runtime hides them from
the main flow but exposes them in presenter mode via a "jump to
backup" picker. Audience never sees them unless the presenter
explicitly navigates.

**Example:**

```html
<Slide kind="backup" topic="unit-economics">
  <h2>Unit economics, full breakdown</h2>
  <Chart data={...} />
</Slide>
```

**Use when:** Investor pitches, exec reviews — anywhere the Q&A
might go deep. Don't bother for short conference talks.

---

## Picking the right archetype

| What you have                               | Use                  |
| ------------------------------------------- | -------------------- |
| One idea + one supporting visual            | `content`            |
| One number that matters                     | `stat`               |
| Two things to contrast                      | `comparison`         |
| A workflow / steps                          | `process`            |
| Someone else's words                        | `quote`              |
| A screenshot, photo, mood                   | `image` / `full-bleed`|
| Code                                        | `code`               |
| Data viz / chart                            | `chart`              |
| The actual product running                  | `demo`               |
| A transition between sections               | `section`            |
| The deck open                               | `title`              |
| The deck close                              | `qa`                 |
| Reference material not in the main flow     | `backup`             |

**The test:** if you don't know which archetype fits, the slide
probably has more than one idea on it. Split it.
