# Logos in video workbooks

Videos need logos. Brand stamps, "powered by" closers, customer
walls, integration partner reveals, lower-third name plates with
a brand mark, pre-roll sponsor cards. Done well, they signal
credibility in a moment. Done badly, they look like a pitch deck
exported to MP4 with low-res PNGs from Google Image Search.

This reference covers the seven sources the CLI fans out across,
the **auto-pick mode** that hides them behind a single
declaration, where logos belong in a composition timeline, and
the storage pattern that keeps videos portable (the whole point
of a workbook).

---

## The short version (recommended)

In `workbook.config.mjs`, list logos by id and **omit `source:`**:

```js
logos: [
  { id: "openai" },
  { id: "stripe" },
  { id: "fda" },
  { id: "github" },
]
```

The CLI tries every known source in order until one returns an
SVG, caches which source won for each id, and inlines as base64
at build time. You don't have to know that `openai` lives on
LobeHub, `fda` lives in the curated pack, and `github` is on
SVGL. You just write the id.

Override with explicit `source:` only when you need a specific
variant (e.g. SVGL has both `discord.svg` and `discord-icon.svg`
— explicit source picks one).

The rest of this doc explains where the SVGs come from, where
logos go in a composition, and how to handle the edge cases.

---

## Sources, in fan-out order

### 1. LobeHub Icons — `lobehub.com/icons`

The best library for **AI products and tools**. OpenAI,
Anthropic, Mistral, Cohere, Hugging Face, LangChain, all the
modern AI SaaS brands, plus general tech. Curated and styled
consistently. Each icon ships in multiple variants (color, mono,
brand).

- **Web:** <https://lobehub.com/icons>
- **npm:** `@lobehub/icons` (React components) or
  `@lobehub/icons-static` (raw SVGs)
- **CDN:** `https://unpkg.com/@lobehub/icons-static/svg/<name>.svg`

Best for: AI / dev-tools / SaaS brand stamps in product videos.

### 2. SVGL — `svgl.app`

Community-curated, broadest coverage. Most consumer brands, most
B2B SaaS, plus many open-source projects. Less consistent styling
across icons (each contributor's variant), so review before using
many side by side in a partner-wall composition.

- **Web:** <https://svgl.app>
- **Direct SVG:** `https://svgl.app/library/<slug>.svg`
- **Search API:** `https://api.svgl.app/?search=<query>`
- **Themed variants:** `<base>-light.svg` and `<base>-dark.svg`
  ship as separate slugs — pick the one matching your video
  background.

Best for: anything LobeHub doesn't have. Customer logo walls of
non-AI brands.

### 3-6. Iconify `logos:`, Iconify `cib:`, Devicon, Simple Icons

The fallback chain after SVGL:

- **Iconify `logos:`** — broad consumer + B2B alternative.
  `https://api.iconify.design/logos/<name>.svg`
- **Iconify `cib:`** (CoreUI Brands) — crypto, finance, smaller
  SaaS. `https://api.iconify.design/cib/<name>.svg`
- **Devicon** — programming languages, frameworks, dev tools
  (~150, consistent style). Best for tech-stack reveal shots.
  `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/<name>/<name>-original.svg`
- **Simple Icons** — monochrome-only, ~3000 brands. Last live
  fallback. Best for monochrome partner walls.
  `https://cdn.simpleicons.org/<slug>`

### 7. Curated pack — `@work.books/cli/data/logos-pack.json`

Hand-curated SVGs shipped inside the CLI for verticals the live
sources miss: US/EU regulators (FDA, CDC, EMA, EPA, SEC, FTC,
NIH), multilaterals (WHO, IMF), central institutions (Fed, NASA,
SWIFT).

To contribute a new entry, see
`packages/workbooks/packages/workbook-cli/data/logos-pack/README.md`.

### Vertical coverage warning

Even with all 7 sources, there are coverage gaps:

- **Major pharma** (Pfizer, Novo Nordisk, Eli Lilly) — trademark
  posture too uncertain for the open libraries. Vendor from the
  brand's own press page.
- **Defense primes** (Lockheed, Northrop, BAE) — same.
- **Most hospital systems and payors** — sparse coverage.
- **Heavy industrial / agriculture** (Caterpillar, BASF, Cargill)
  — some in SVGL/Iconify, most not.

For these: vendor the SVG yourself under `src/assets/` and import
with `?raw` (see [manual fallback](#manual-fallback) below).
Always check the brand's usage guidelines before redistributing.

---

## Storage pattern: inline base64 at build time

**The rule:** every logo a video uses gets fetched once at
`workbook build` time and inlined as base64 in the source bundle.
The video never makes a network request for a logo at runtime.

Why this matters:

- **Recipient wifi is unreliable.** A workbook is often watched on
  a laptop on someone's hotel wifi. A logo that loads from a CDN
  is a logo that pops in late or never.
- **Workbooks are portable.** A `.html` artifact you can email is
  the value proposition. Runtime fetches break that.
- **CDN URLs rot.** A logo URL that works today might 404 in 6
  months. Inline is forever.

### Declare in `workbook.config.mjs`

```js
export default {
  slug: "my-promo",
  type: "spa",
  manifest: {
    compositions: ["main.html"],
  },
  // Recommended: just list ids. CLI fans out across all 7 sources.
  logos: [
    { id: "openai" },
    { id: "anthropic" },
    { id: "stripe" },
    { id: "vercel" },
    { id: "github" },
    { id: "fda" },           // resolves to the curated pack
  ],
};
```

If you need a specific source:

```js
logos: [
  { id: "openai",  source: "lobehub" },
  { id: "discord", source: "svgl" },
  { id: "fda",     source: "pack" },
]
```

### Use in a scene

Import `getLogos` once at the top of the composition (in the
`<gm-doc>`-bootstrapping script or a module loaded by the page),
expose it as `window.__logos`, and read from it inside each
scene's mount script:

```html
<script type="module">
  import { getLogos } from "@work.books/runtime/presentation";
  window.__logos = getLogos();
</script>
```

Then inside a scene:

```html
<gm-scene id="customers" start="12s" duration="4s">
  <template>
    <div class="logo-row">
      <img data-logo="openai" alt="OpenAI">
      <img data-logo="anthropic" alt="Anthropic">
      <img data-logo="stripe" alt="Stripe">
    </div>
    <script>
      gamut.onReady("customers", (root) => {
        const logos = window.__logos;
        root.querySelectorAll("[data-logo]").forEach(el => {
          el.src = logos[el.dataset.logo].dataUrl;
        });
      });
    </script>
  </template>
</gm-scene>
```

`logos[name]` returns `{ dataUrl, svg }`. Use `dataUrl` for
`<img>`; `svg` for injecting the markup directly (`el.innerHTML
= logos[name].svg`) when you want to drive the color via CSS
(`fill: currentColor`).

### Verifying + manual fallback

The build wraps the artifact in a gzip shim, so `grep wb-logos
dist/<slug>.html` returns 0 hits even when logos are present —
`workbook unbundle` to verify, or check the build log for
`[workbook] logos: fetched N`. For logos the live sources don't
have: `curl -sL https://svgl.app/library/<slug>.svg >
src/assets/<slug>.svg` and `import slug from
"../assets/<slug>.svg?raw"` with `{@html slug}` in scene HTML.

---

## Where logos live in a composition timeline

A logo is a *moment*, not a decoration. It gets placed
deliberately in the shot list, not scattered across the
composition.

### Pattern 1 — Intro card (opening brand stamp)

The video opens on the brand mark for 1.0–1.5 seconds before any
content. Use for brand spots, pitch videos, conference talk
recaps where the brand is the host.

Declare the logo once as a doc-root asset, then schedule a scene
that mounts it and fades out at the end:

```html
<gm-asset id="brand" kind="image" src="brand/logo.svg"></gm-asset>

<gm-scene id="brand-in" start="0s" duration="1.5s">
  <template>
    <img class="brand-mark" src="brand/logo.svg" alt="">
    <script>
      gamut.onReady("brand-in", () => {
        gsap.from(".brand-mark", { opacity: 0, duration: 0.3, ease: "power1.out" });
        gsap.to(".brand-mark", { opacity: 0, duration: 0.2, delay: 1.3, ease: "power1.in" });
      });
    </script>
  </template>
</gm-scene>
```

**Rules:**
- Hold ≥ 1.0s. Anything shorter reads as a glitch.
- One element on screen. Don't pair with a tagline on the first
  intro card.
- Match background to brand asset. A dark logo on a dark stage
  needs the alternate variant.

### Pattern 2 — Closing brand stamp ("powered by" / tag card)

The standard closer for sales pitch videos, social ads, brand
spots. The viewer's last frame is the brand.

```html
<gm-scene id="tag" start="28s" duration="2s">
  <template>
    <img class="tag-logo" src="brand/logo.svg" alt="">
    <p class="tag-url">workbooks.sh</p>
    <script>
      gamut.onReady("tag", () => {
        gsap.from(".tag-logo", { opacity: 0, duration: 0.3, ease: "power1.out" });
        gsap.from(".tag-url", { opacity: 0, y: 8, delay: 0.8, duration: 0.4, ease: "power2.out" });
      });
    </script>
  </template>
</gm-scene>
```

**Rules:**
- Hold the closing logo 1.5–3 seconds. This is the frame the
  viewer remembers.
- URL appears AFTER the logo settles, not at the same time.
  Hierarchy of attention.
- No motion on the logo itself in the closing frame. Let it sit.

### Pattern 3 — Corner watermark (persistent throughout)

A small brand mark in a corner that persists across every scene.
Use for talk recaps, recorded webinars, anything where the
brand should be discoverable in a thumbnail without dominating.

Put the watermark on its own high-z track that spans the full
timeline — it persists across every cut underneath:

```html
<gm-track id="watermark" z="50">
  <gm-scene id="wm" start="0s" duration="30s">
    <template>
      <img class="watermark" src="brand/logo.svg" alt="">
    </template>
  </gm-scene>
</gm-track>
```

```css
.watermark {
  position: absolute;
  bottom: 32px;
  right: 32px;
  width: 120px;
  opacity: 0.6;
  pointer-events: none;
}
```

**Rules:**
- 4–8% of frame width max. Bigger reads as a sponsor banner.
- Opacity 50–70% so it doesn't fight content.
- Anchor to a corner; never centered.

### Pattern 4 — Lower-third name plate with brand mark

Talking-head shots that identify the speaker. The brand mark
sits next to the name, not over it.

```html
<gm-scene id="speaker" start="4s" duration="6s">
  <template>
    <div class="lower-third">
      <img class="brand" data-logo="acme" alt="">
      <div>
        <p class="name">Jane Doe</p>
        <p class="role">Founder, Acme</p>
      </div>
    </div>
    <script>
      gamut.onReady("speaker", (root) => {
        const logos = window.__logos;
        root.querySelectorAll("[data-logo]").forEach(el => {
          el.src = logos[el.dataset.logo].dataUrl;
        });
        gsap.from(".lower-third", { y: 24, opacity: 0, duration: 0.5, ease: "power2.out" });
      });
    </script>
  </template>
</gm-scene>
```

**Rules:**
- Brand mark left of the name, ~1× the name's height.
- One brand mark per lower-third. Co-branded interviews use
  two; never three.
- Lower-third anchored bottom-left, leaving room for captions
  bottom-center.

### Pattern 5 — Partner / customer wall (one shot or full scene)

A wall of customer or integration logos, usually under a heading
like "trusted by" or "integrates with".

```html
<gm-scene id="customers" start="12s" duration="4s">
  <template>
    <h2>Trusted by</h2>
    <div class="logo-wall">
      <img data-logo="openai" alt="OpenAI">
      <img data-logo="anthropic" alt="Anthropic">
      <!-- 6–12 total -->
    </div>
    <script>
      gamut.onReady("customers", (root) => {
        const logos = window.__logos;
        root.querySelectorAll("[data-logo]").forEach(el => {
          el.src = logos[el.dataset.logo].dataUrl;
        });
        gsap.from(".logo-wall img", { opacity: 0, y: 12, duration: 0.4, stagger: 0.06, ease: "power2.out" });
      });
    </script>
  </template>
</gm-scene>
```

**Rules:**
- 6–12 logos max. More stops being credibility, becomes noise.
- All same color treatment (all color OR all monochrome).
  Mixing looks accidental.
- All same optical weight. A wordmark and a glyph at the same
  pixel-height read differently — resize by optical size.
- Use Simple Icons for monochrome walls — they're already
  normalized.

---

## Logo entry / exit animations

The temptation is to animate every logo for animation's sake.
Resist. Logos earn a moment of stillness.

### Allowed

- **Fade in over 8–15 frames.** The most restrained reveal.
  Reads as "this brand is now on screen."
- **Scale from 0.92 → 1.0 over 12 frames.** A whisper of
  anticipation. Use on closing brand stamps where you want a
  micro-beat before the hold.
- **Crossfade between two related brands** in a co-branded
  card. 15-frame crossfade.

### Not allowed

- **Spinning logos.** Ever. Even in 2026, this still happens.
- **Logos that orbit other elements.** The brand is not a
  satellite of the content.
- **Letter-by-letter wordmark reveal.** The wordmark IS the
  brand; fragmenting it dilutes the mark.
- **Distortion or skew on entry.** Ditto — the mark is the
  mark.
- **Multiple effects on the same logo.** Pick one (fade OR
  scale), not both.

Cross-reference: [motion.md](motion.md) and [gsap.md](gsap.md)
for easing choices. Logo reveals stick to `power1.out` or
`power2.out` (one deliberate, confident reveal). Never use
`elastic`, `back`, or `bounce` easings on a brand mark — the
overshoot reads as undisciplined.

---

## Brand guideline checklist

Before shipping a video with company logos:

- [ ] **Resolution.** Use SVG. Never use a raster logo that
      scales below crisp at the video's resolution.
- [ ] **Color treatment.** Use the brand's official color
      version if the brand cares (most do).
- [ ] **Clear space.** Logos need margin around them. Don't
      crowd a logo against a heading or another logo.
- [ ] **Aspect.** Don't distort. Wordmarks have a height; glyphs
      have a square box; respect them.
- [ ] **No alteration.** Don't add shadows, gradients, glows, or
      lock-up modifications to someone else's brand.
- [ ] **Permission check.** Customer logos for marketing videos
      should be cleared by the customer.
- [ ] **No competitor logos in negative framing.** Implying their
      logo represents something bad (e.g. red X over it) is a
      trademark dilution risk. Discuss with legal first.

---

## What NOT to do

- **Animate the logo for animation's sake.** The brand is not
  the dance.
- **Pull from the brand's own homepage.** Often a complex SVG
  with embedded fonts that don't render outside the source
  context. Use the canonical libraries above.
- **Re-color a logo to match your palette.** Brand colors are
  brand identity.
- **Stretch a wordmark to fit a square frame.** Use the glyph
  version, or change the layout.
- **Open AND close on the same brand stamp.** Pick one. Both
  reads as filler.
