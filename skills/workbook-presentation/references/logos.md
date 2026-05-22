# Logos in presentation workbooks

Presentations need logos. Customer logo walls, "powered by" rows,
"integrates with" grids, competitor comparisons, "as featured in"
strips. Done well, they signal credibility. Done badly, they look
like a freshman's PowerPoint with low-res PNG screenshots from
Google Image search.

This reference covers the seven sources the CLI fans out across, the
**auto-pick mode** that hides them behind a single declaration, and
the storage pattern that keeps presentations portable (which is the
whole point of a workbook).

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

The CLI tries every known source in order until one returns an SVG,
caches which source won for each id, and inlines as base64 at build
time. You don't have to know that `openai` lives on LobeHub, `fda`
lives in our curated pack, and `github` is on SVGL. You just write
the id.

Override with explicit `source:` only when you need a specific
variant (e.g. SVGL has both `discord.svg` and `discord-icon.svg` —
explicit source picks one).

The rest of this doc explains where the SVGs come from and how to
handle the edge cases.

---

## Sources, in fan-out order

### 1. LobeHub Icons — `lobehub.com/icons`

The best library for **AI products and tools**. OpenAI, Anthropic,
Mistral, Cohere, Hugging Face, LangChain, all the modern AI SaaS
brands, plus general tech. Curated and styled consistently. Each
icon ships in multiple variants (color, mono, brand).

- **Web:** <https://lobehub.com/icons>
- **npm:** `@lobehub/icons` (React components) or
  `@lobehub/icons-static` (raw SVGs)
- **CDN:** `https://unpkg.com/@lobehub/icons-static/svg/<name>.svg`

Best for: AI / dev-tools / SaaS brand grids.

### 2. SVGL — `svgl.app`

Community-curated, broadest coverage. Most consumer brands, most
B2B SaaS, plus many open-source projects. Less consistent styling
across icons (each contributor's variant), so review before using
many side by side.

- **Web:** <https://svgl.app>
- **Direct SVG:** `https://svgl.app/library/<slug>.svg` (returns
  the SVG with the right content-type — what the CLI fetches).
- **Search API:** `https://api.svgl.app/?search=<query>` (returns
  JSON; use to disambiguate before settling on a slug).
- **Themed variants:** `<base>-light.svg` and `<base>-dark.svg`
  ship as separate slugs — pick the one matching your deck theme.

Best for: anything LobeHub doesn't have. Customer logo walls of
non-AI brands.

### 3. Iconify `logos:` collection — `iconify.design`

Broad alternative to SVGL. Iconify aggregates 100+ icon sets; the
`logos:` collection is its curated brand set with strong consumer
+ B2B SaaS coverage.

- **Web:** <https://icones.js.org/collection/logos>
- **CDN:** `https://api.iconify.design/logos/<name>.svg`

Best for: anything LobeHub and SVGL don't have.

### 4. Iconify `cib:` collection — CoreUI Brands

Strong on crypto, finance, smaller SaaS that SVGL/Iconify-logos miss.

- **Web:** <https://icones.js.org/collection/cib>
- **CDN:** `https://api.iconify.design/cib/<name>.svg`

Best for: crypto + financial brands not in SVGL.

### 5. Devicon — `devicon.dev`

Programming languages, frameworks, dev tools. ~150 entries, very
consistent styling.

- **Web:** <https://devicon.dev>
- **CDN (via jsDelivr):** `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/<name>/<name>-original.svg`

Best for: tech-stack slides ("we use Python + Postgres + Redis…").

### 6. Simple Icons — `simpleicons.org`

Monochrome-only. ~3000 brands. The last live-source fallback when
none of the colored sources have a logo.

- **Web:** <https://simpleicons.org>
- **CDN:** `https://cdn.simpleicons.org/<slug>`

Best for: monochrome grids. Don't force this for hero placements
where the brand color matters — use one of the colored sources or
the curated pack instead.

### 7. Curated pack — `@work.books/cli/data/logos-pack.json`

Hand-curated SVGs shipped inside the CLI for verticals the live
sources miss: US/EU regulators (FDA, CDC, EMA, EPA, SEC, FTC, NIH),
multilaterals (WHO, IMF), central institutions (Fed, NASA, SWIFT).

To contribute a new entry, see
`packages/workbooks/packages/workbook-cli/data/logos-pack/README.md`.

### Vertical coverage warning

Even with all 7 sources, there are coverage gaps:

- **Major pharma** (Pfizer, Novo Nordisk, Eli Lilly) — trademark
  posture too uncertain for the open libraries. Vendor from the
  brand's own press page.
- **Defense primes** (Lockheed, Northrop, BAE) — same.
- **Most hospital systems and payors** — sparse coverage everywhere.
- **Heavy industrial / agriculture** (Caterpillar, BASF, Cargill) —
  some in SVGL/Iconify, most not.

For these: vendor the SVG yourself under `src/assets/` and import
with `?raw` (see [manual fallback](#manual-fallback) below). Always
check the brand's usage guidelines before redistributing.

---

## Storage pattern: inline base64 at build time

**The rule:** every logo a presentation uses gets fetched once at
`workbook build` time and inlined as base64 in the source bundle.
The presentation never makes a network request for a logo at
runtime.

Why this matters:
- **On-stage wifi is unreliable.** A logo that loads from a CDN
  on slide-show is a logo that doesn't render when the venue's
  network drops.
- **Workbooks are portable.** A `.html` artifact you can email is
  the value proposition. Runtime fetches break that.
- **CDN URLs rot.** A logo URL that works today might 404 in 6
  months. Inline is forever.

### Declare in `workbook.config.mjs`

```js
export default {
  slug: "my-deck",
  type: "presentation",
  // Recommended: just list ids. CLI fans out across all 7 sources
  // and uses the first that returns an SVG.
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

If you need a specific source (e.g. one library's variant is the
right brand color):

```js
logos: [
  { id: "openai",  source: "lobehub" },
  { id: "discord", source: "svgl" },   // SVGL has both .svg and -icon.svg
  { id: "fda",     source: "pack" },   // force the pack
]
```

### Use in slides

Import `getLogos` from the **presentation subpath** (not the main
runtime barrel — the main barrel pulls in the agent runtime which
breaks Vite browser builds):

```js
import { getLogos } from "@work.books/runtime/presentation";

const logos = getLogos();
```

Then in markup:

```html
<Slide kind="content">
  <h2>Built on what you already use</h2>
  <div class="logo-row">
    {#each Object.entries(logos) as [name, logo]}
      <img src={logo.dataUrl} alt={name} />
    {/each}
  </div>
</Slide>
```

Or pluck a specific one:

```html
<img src={logos.openai.dataUrl} alt="OpenAI" />
```

`logos[name]` returns `{ dataUrl, svg }`. Use `dataUrl` for
`<img src=>`, `svg` for `{@html …}` inlining when you want to
style the SVG with CSS.

### Verifying the build actually inlined them

`workbook build` wraps the artifact in a gzip self-decompress shim,
so `grep wb-logos dist/<slug>.html` returns 0 hits even when logos
are present. To verify, decompress first:

```bash
node packages/workbooks/packages/workbook-cli/bin/workbook.mjs \
  unbundle dist/<slug>.html /tmp/check
grep -c "wb-logos" /tmp/check/dist/<slug>.html  # should be ≥ 1
```

Or check the build log — the logo helper prints `[workbook] logos:
fetched N` on success and `[workbook] logos: failed to fetch …` for
each miss.

### Manual fallback (skip the build helper)

When you need a logo the three sources don't have, vendor it
yourself:

```bash
# AI / dev / consumer brands — sources work:
curl -sL https://unpkg.com/@lobehub/icons-static/svg/openai.svg \
  > src/assets/openai.svg
curl -sL https://svgl.app/library/stripe.svg > src/assets/stripe.svg
curl -sL https://cdn.simpleicons.org/github > src/assets/github.svg

# Vertical-specific (pharma / defense / finance back-office):
# Download from the brand's own asset page after checking guidelines.
# Drop into src/assets/<slug>.svg.
```

Then in the slide:

```html
<script type="module">
  import openai from "./assets/openai.svg?raw";
  import stripe from "./assets/stripe.svg?raw";
</script>

<Slide kind="content">
  <h2>Powered by</h2>
  <div class="logo-row">
    {@html openai}
    {@html stripe}
  </div>
</Slide>
```

Vite (which the workbook-cli uses) bundles the `?raw` SVG imports
into the final HTML.

---

## Logo layout patterns

### Logo wall (customer / integration grid)

```html
<Slide kind="content">
  <h2>Trusted by 200+ teams</h2>
  <div class="logo-wall">
    <!-- 6-12 logos in a grid, all monochrome or all color -->
  </div>
</Slide>
```

**Rules:**
- 6-12 logos max. More than 12 stops being credibility, becomes
  noise.
- All same color treatment (all color OR all monochrome). Mixing
  looks accidental.
- All same visual weight (resize to optical size, not pixel
  size — a wordmark and a glyph at the same pixel-height read
  differently).
- Use Simple Icons for monochrome walls — they're already
  normalized.

### "Powered by" / footer strip

```html
<Slide kind="content">
  <h2>Our content takeaway</h2>
  <p>The content goes here.</p>
  <footer class="powered-by">
    Built with
    {@html openai}
    {@html anthropic}
    {@html stripe}
  </footer>
</Slide>
```

**Rules:**
- 3-5 logos. Smaller than the wall.
- Always include the word "Built with" / "Powered by" — logos
  alone are ambiguous.

### Side-by-side competitor comparison

```html
<Slide kind="comparison">
  <h2>Why us</h2>
  <div class="col">
    <h3>{@html competitorA}</h3>
    <p>Their approach: X. Cost: Y.</p>
  </div>
  <div class="col">
    <h3>{@html competitorB}</h3>
    <p>Their approach: P. Cost: Q.</p>
  </div>
  <div class="col us">
    <h3>{@html ourLogo}</h3>
    <p>Our approach: better. Cost: less.</p>
  </div>
</Slide>
```

**Rules:**
- Be careful with competitor logos — using a competitor's brand
  in a comparison slide is legal (nominative fair use) but their
  brand guidelines may prohibit recoloring or distorting.
- Don't shrink a competitor's logo to look insignificant. Looks
  petty.

---

## Brand guideline checklist

Before shipping a deck with company logos:

- [ ] **Resolution.** Use SVG. Never use a raster logo that
      scales below crisp.
- [ ] **Color treatment.** Use the brand's official color
      version if the brand cares (most do). Check the brand's
      brand page.
- [ ] **Clear space.** Logos need margin around them. Don't
      crowd a logo against a heading or another logo.
- [ ] **Aspect.** Don't distort. Wordmarks have a height; glyphs
      have a square box; respect them.
- [ ] **No alteration.** Don't add shadows, gradients, glows, or
      lock-up modifications to someone else's brand.
- [ ] **Permission check.** Customer logos for marketing
      presentations should be cleared by the customer. "We use
      logo without asking" is the kind of thing that triggers a
      legal email.
- [ ] **No competitor logos in negative framing.** Implying their
      logo represents something bad (e.g. red X over it) is a
      trademark dilution risk. Discuss with legal first.

---

## What NOT to do

- **Google Image Search → save as PNG.** Low-res, often the wrong
  variant, sometimes someone's fan-art.
- **Pull from the brand's own homepage.** Often a complex SVG
  with embedded fonts that don't render outside the source
  context. Use the canonical libraries above.
- **Re-color a logo to match your palette.** Brand colors are
  brand identity. Adjusting them looks unprofessional and may
  violate guidelines.
- **Stretch a wordmark to fit a square space.** Use the glyph
  version, or change the layout.
