# Curated logo pack

A small, hand-curated set of SVG logos for verticals the open sources
miss — US/EU regulators, central banks, multilaterals, and other
institutional brands that LobeHub / SVGL / Iconify / Devicon / Simple
Icons don't carry.

## How the chain works

When an author writes:

```js
// workbook.config.mjs
logos: [
  { id: "openai" },          // resolves to lobehub
  { id: "fda" },             // resolves to this pack
  { id: "stripe" },          // resolves to svgl
]
```

…the CLI tries each open source in order, then falls back to this
pack as the last resort before declaring the slug missing.

To force the pack:

```js
{ id: "fda", source: "pack" }
```

## Adding a new entry

Edit `../logos-pack.json`. Each entry is:

```json
"<slug>": {
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"…\">…</svg>",
  "source": "<where you got it — URL or 'hand-set'>",
  "license": "<license terms — be specific>",
  "notes": "<optional: design notes, replacement instructions>",
  "updated": "<ISO date you added/updated this entry>"
}
```

### Slug naming

- Lowercase, hyphenated, matches the common short name people would type.
- Government agencies: use the acronym (`fda`, `cdc`, `nih`). NOT
  `food-and-drug-administration`.
- Companies: use the brand's preferred short name (`pfizer`, not
  `pfizer-inc`).
- Variants get suffixes: `nasa-meatball`, `nasa-worm`.

### License discipline (required)

Every entry MUST cite license. The four categories we accept:

1. **US government works** — public domain under 17 USC § 105.
   Agencies like FDA, CDC, NIH, EPA, NASA fall here. Cite as:
   `"US government work — public domain (17 USC § 105)"`.

2. **Public domain / CC0** — explicit waivers from the rights holder
   or works that have entered the public domain.

3. **Permissive open** — CC BY, MIT, Apache 2.0 etc. Include
   attribution requirements in the `notes` field.

4. **Trademark — nominative fair use** — used to identify the brand
   when referenced in a workbook, NOT modified, NOT used as
   endorsement. Risky territory; only include if the workbook use
   case clearly qualifies. Cite as:
   `"trademark — nominative fair use only; check <brand> guidelines for derivative use"`.

Do NOT include logos that require explicit license fees or have
restrictive brand guidelines prohibiting reproduction (defense
primes, most banks). If in doubt, omit.

### SVG quality bar

- Single root `<svg>` element with explicit `viewBox`.
- No external font references (use system serif/sans or inline glyphs).
- No external `<image>` or `<use href="...">` to remote resources.
- Reasonable file size — under 8 KB. If a logo is larger, simplify
  the artwork (most institutional logos can render as a wordmark on
  a colored rect with no fidelity loss for presentation use).
- Use the brand's official color when possible. For US government
  agencies, use the agency's documented brand color from their
  brand portal (most have one).

### Hand-set placeholders

Many entries in the initial pack are simple wordmark placeholders
(white text on a colored rect). They're useful for presentation
density but not for hero placements. If you need a hero version,
either:

- Find the official SVG on the brand's press / brand portal page
  and replace the entry, OR
- Source from Wikimedia Commons (most major institutional logos
  are uploaded there under PD or fair use) and check the file's
  license tag before adding.

When replacing a placeholder, bump the `updated` date.

## What we deliberately don't include

- Defense primes (Lockheed, Northrop, BAE) — trademark posture too
  uncertain; brand guidelines often prohibit reproduction.
- Major pharma (Pfizer, Eli Lilly, Novo Nordisk) — same. Source
  these from the brand's own press page if needed for a deck.
- Streaming / media (Disney, Netflix, etc.) — covered by Wikipedia
  Commons under their own fair-use rules; not worth duplicating.

## How to verify a logo before adding

1. Load the SVG in a browser — does it render?
2. Resize the SVG element from 16px to 800px — is it readable at all
   sizes? (No raster fallback.)
3. Drop the SVG onto a white background AND a dark background. Does
   it still read? If not, document the constraint in `notes`.
4. Check `<svg>` doesn't contain `<script>` or `<foreignObject>` —
   security smell, reject.
