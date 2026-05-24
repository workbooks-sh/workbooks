---
name: wavelet-director
description: Use when the user wants to produce a short generative video — a 10-30 second commercial, brand spot, montage, or trailer — entirely from a written brief, using only the `wavelet` CLI + Fal / ElevenLabs AI backends + the web for reference. Triggers on "make a commercial", "generate a video ad", "produce a spot", "direct a video from a brief", "end-to-end generative video".
---

# wavelet-director — end-to-end generative video

You are the director. Take a brief (or invent one), produce a finished MP4.
Every visible frame and every audible sample is AI-generated. No stock
footage, no hand-edited timeline, no manual asset wrangling.

## What wavelet actually is

Wavelet is a motion-graphics renderer. **Blitz** handles HTML layout,
**Stylo** (Servo's parallel CSS engine) computes styles and drives the
animation clock, **Parley** shapes text, **Animato** powers timeline
math, **Vello** rasterizes through wgpu, **rsmpeg** encodes h264/h265.
The render loop walks frame-by-frame, ticks the CSS animation engine via
`BaseDocument::resolve(now)` so every `@keyframes` rule and every
`transition` advances to the current scene time, paints to RGBA,
composites over a per-scene background video (and audio cues mixed
through rsmpeg), and writes an MP4 + sidecar WAV.

The author surface is HTML. One file per scene (`scenes/01-title.html`,
`scenes/02-product.html`, …). One top-level `index.html` lists the
scenes and binds the audio. That is the entire authoring layer. No JSON
sidecars, no DSLs, no JS, no proprietary timeline format. The JSON
exception: every `.json` artifact in the workdir (`screenplay.json`,
`velocity.json`, `storyboard.json`, `transitions.json`, `captions.json`)
must come from a wavelet CLI subcommand — `wavelet screenplay parse`,
`wavelet velocity propose`, `wavelet storyboard plan`, `wavelet
transitions classify`, `wavelet captions align`. The agent never
hand-writes these JSON files. Fallback: if a CLI tool fails repeatedly,
hand-authoring is acceptable as last-resort recovery, but should be
noted in `notes.md`.

**The hard rule:** this isn't a browser, but you write as if it is. If
something is standard CSS, assume it works — the exceptions are listed
explicitly below. Stylo and Blitz cover the bulk of the modern web
platform. Reach for the same idioms you'd use building a hand-crafted
landing page: `@keyframes`, `transition`, `clip-path`, `mix-blend-mode`,
flexbox, grid, gradients, `transform`, `cubic-bezier()`, web fonts via
`@font-face`. They render.

**The anti-pattern this doc is written to prevent.** Every freshly-spun
agent writes the same thing on its first try: four scenes, all
`position: absolute; left: 80px; bottom: 80px; font: 900 88px Inter;`,
no `clip-path`, no `mix-blend-mode`, no animation beyond a single
`@keyframes fade-in`. That's the **AI-default lockup**. It looks like
every other AI commercial, and every senior creative director can spot
it in one frame. If your spot looks like every other AI ad, you skipped
the palette — go back and use it.

## Tools you need

- **`wavelet` CLI** — the entire pipeline. Single binary at
  `packages/wavelet/target/debug/wavelet` from the repo root, or just `wavelet`
  if it's on PATH.
- **The web** — research the subject of the commercial (palette, mood,
  reference shots) to inform your prompts. Use WebSearch/WebFetch.
- **Bash** — for parallel shot generation and one final ffmpeg mux step.
- **`FAL_KEY` + `ELEVENLABS_API_KEY`** — pre-exported in env. Don't
  print them. The CLI reads them.

## Componentized assets: clip-refs

Every generated asset — shots, stills, music, dialogue, screenplay scenes — is paired with a `.clip.html` file under `<workdir>/refs/<kind>/`. These are emitted automatically by every producer (no flag, no opt-in). Each clip-ref carries:

- **YAML front matter**: `clip` (ULID), `kind`, `asset`, `asset-hash`, `provider`, `model`, `cost-usd`, `prompt`, `parent`, `edit-kind`, `scene`, `tags`, `created-at`
- **HTML body**: a renderable preview (`<video>` / `<img>` / `<audio>`) that browsers + Studio render as-is

Reference clip-refs from scene HTML via the custom element:

```html
<wavelet-clip src="../refs/shot/shot-int-kitchen-day-hero-pour-a1b2c3.clip.html"></wavelet-clip>
```

The compose pre-pass substitutes the element with `<video src="…" autoplay muted playsinline>` (for `kind=shot`), `<img src="…">` (for `kind=still`), or inlines the body verbatim (for `kind=overlay`). Music + TTS clip-refs are hoisted into the composition's `audio_cues` instead of inlined. Use this form instead of raw `assets/shot-3.mp4` paths — it carries lineage, cost, and prompt provenance.

Hand-authored overlays use the same shape: write a `.clip.html` with `kind: overlay` and a body containing your HTML/CSS. Same registry, same compose-time resolution.

### Anti-patterns the compose pre-pass DOES NOT process

The pre-pass recognizes EXACTLY these two surfaces for scene composition:
`<wavelet-clip src="...">` (the canonical form above) and raw `<video src="...">` /
`<img src="...">` / `<audio src="...">` elements inside the scene HTML.
Everything else is invisible. **Do not invent attributes** — they will be
silently dropped, your Veo spend will be orphaned, and the rendered MP4
will contain text-only overlays with no video underneath.

Known hallucinations that have burned real spend (wb-a2z2, eval 008):

| Hallucinated | What you actually want |
|---|---|
| `<section data-video-bg="shots/X.mp4">` (on commercial.html) | Put `<video src="../shots/X.mp4" autoplay muted loop playsinline style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;"></video>` INSIDE the scene HTML itself, with text overlays absolutely-positioned above. |
| `<section data-scene-href="scenes/01-pour.html">` (compose-style routing on commercial.html) | Use the standard scene-list pattern that `wavelet render commercial.html` already recognizes — don't add custom `data-*` attributes hoping the renderer will follow them. |
| `data-shot=`, `data-bg=`, `data-clip=` etc. on any element | Either use `<wavelet-clip src="...">` (preferred — carries lineage) or a raw `<video src="...">` inside the scene HTML. |

The wavelet renderer has no plug-in surface for custom `data-*` attributes
on composition or scene elements. If you find yourself reaching for one,
you're inventing a feature that doesn't exist. Stop, re-read this section,
and use one of the two recognized surfaces above.

### Edit chains

When you refine an existing clip, the producer chains via `--parent <clip-id> --edit-kind <kind>`:

```bash
# 1. generate a still
wavelet shot still --prompt "hand pouring water" --scene "INT. KITCHEN - DAY"
# emits refs/still/still-int-kitchen-day-hand-pouring-water-a1b2c3.clip.html

# 2. surgical Kontext edit
wavelet shot fix --parent 01JQX9NXFVR2D5JBQGFCWQHZNX --intent "warmer rim light on the hand"
# emits refs/still/still-…-fixed-d4e5f6.clip.html  with parent: 01JQX9NXFV…

# 3. inspect the chain
wavelet clip lineage 01JQX9NX
```

### Inspection

```
wavelet clip ls [--kind <kind>] [--scene <slug>] [--tag <tag>] [--lineage]
wavelet clip show <short-id-or-path>
wavelet clip lineage <short-id>
wavelet clip import [--workdir <path>] [--dry-run]   # backfill a legacy workdir
```

`wavelet clip lineage` prints an ASCII tree of the full ancestry + descendants for one clip. Use it when an asset looks wrong and you need to trace back to the prompt that produced it.

### Screenplay scenes

`wavelet screenplay parse script.fountain` emits one `refs/screenplay-scene/<NNN>-<slug>-<hash>.clip.html` per scene by default (use `--legacy-json` to emit the old single-blob `screenplay.json`). Velocity / storyboard / continuity stages read from either source. Round-trip with `wavelet screenplay reassemble <workdir>` — byte-identical for canonical-formatted input.

## The default production path

For each scene, write a rich scene + motion prompt and call `wavelet
shot txt2vid` to generate the clip directly via Veo. One step per
shot — no still-then-clip two-step.

```
web research → palette + composition + motion reference
            → for each scene:
                wavelet shot txt2vid "<scene + motion prompt>" --duration 5
```

Defaults: `GOOGLE_API_KEY` unlocks video (Veo 3.1 / Veo 3.1 Fast),
image (Nano Banana 3), and music (Lyria 3) directly. `ELEVENLABS_API_KEY`
unlocks TTS. Two keys, full pipeline. See `wavelet pipelines show
commercial` for the canonical `tier_policy`.

Cost per shot: ~$0.40 txt2vid (5s at Veo 3.1 Fast). Hero shots that
need full Veo 3.1 run ~$2.50/shot at 5s.

For real branded products where logo/badge fidelity matters, txt2vid
alone hallucinates the marks. Use `wavelet shot fix --intent "<correct
the logo to match this reference>"` after generation to apply surgical
Flux Kontext Max edits, rather than re-rolling the clip.

## The pipeline (run in order)

```
brief.md (9-line) → wavelet brief check
            │
            ├─ write screenplay
            ├─ wavelet screenplay parse → screenplay.json (sanity check)
            ├─ wavelet velocity propose → velocity.json
            ├─ wavelet storyboard plan  → storyboard.json
            ├─ wavelet storyboard verify → must be 0 errors
            ├─ wavelet continuity check  → must be 0 errors
            ├─ wavelet transitions classify → transitions.json
            │
            ├─ wavelet music gen → music/track.wav   (paid: ~$0.06)
            ├─ wavelet velocity validate --against music/track.wav  (sanity)
            │
            ├─ for each scene:
            │   wavelet shot txt2vid → shots/shot-N.mp4 (paid: ~$0.10 each)
            │
            ├─ write scene HTML overlays (the freeform palette section)
            ├─ assemble commercial.html manifest
            └─ wavelet render commercial.html -o commercial.mp4
```

Canonical pipeline spec lives at `wavelet pipelines show commercial`. The
workflow runner walks it cooperatively — `wavelet workflow run commercial
--workdir .` reports the next stage based on which artifacts are on disk.

## Gating spend with the reviewer

After each stage produces an artifact — storyboard JSON, per-shot
txt2vid MP4, the final muxed cut —
invoke the `wavelet-reviewer` skill with the stage name + artifact path
+ the brief. It returns a structured pass/warn/fail verdict and a
`spend_decision` of `proceed`, `iterate`, or `abort`. Honor it: only
move to the next paid step on `proceed`. On `iterate`, apply the
named remediation (re-roll, `fix-from-verify`, tighten the prompt)
and re-review. On `abort` (the same fail has recurred ≥ 3 times),
stop and report back rather than burning more budget. The reviewer
only reads — it never spends — so calling it between every stage is
free insurance against compounding errors.

## Brand resolution — run FIRST when a brief names a brand without a domain

Before ANY brandwork call that requires a known domain (`brief`, `brand fetch`,
`logo`, `fonts`), the agent MUST confirm it has the canonical domain for the
brand in the brief. If the brief gives a name or product description without
a clear domain, run:

```bash
brandwork resolve "<query>"
```

Take `candidates[recommended].domain` as the domain and proceed. If the
top candidate has confidence below 0.50, note the uncertainty in `strategy.md`
and consider falling back to a Web search to confirm.

Examples:
- Brief says `"livconscious wellness brand"` → `brandwork resolve "livconscious"` → `weliveconscious.com`
- Brief says `"Whirlpool stand mixer"` → `brandwork resolve "Whirlpool stand mixer"` → `kitchenaid.com`
- Brief says `"Made in USA 990v6 sneaker"` → `brandwork resolve "Made in USA 990v6 sneaker"` → `newbalance.com`

Record the `resolve` result verbatim in `strategy.md` under a `Domain resolution`
heading before calling any downstream brandwork command.

If the brief ALREADY contains a clean domain (e.g. `allbirds.com`), skip `resolve`
and proceed directly to the Phase 1 gate calls below.

## Phase 1 gate — brand-research is non-negotiable

Phase 1 (creative strategy) cannot end and Phase 2 (storyboard /
generation) cannot start until the agent has invoked AT LEAST these
four `brandwork` calls AND retrieved a real logo asset AND
researched a real specific product, recording all of it verbatim in
`strategy.md`:

1. `brandwork brand.brief <domain>` — the brand's identity surface
   (logo URL, palette, typography, tagline). Resolve `<domain>` from
   the user's brief. If the brief names a parent brand whose product
   actually ships under a sub-brand (e.g. "Whirlpool stand mixer" —
   the real product brand is KitchenAid, which Whirlpool acquired in
   1986), the agent FIRST resolves the actual product brand via
   `brandwork resolve`, THEN runs `brand.brief` against the ACTUAL
   product brand's domain. Never run `brand.brief` on the parent
   brand and call it done.

2. `brandwork brand.product domain=<x> query=<sku>` — product image
   URLs and SKU descriptors. If the user's brief said "make me a
   New Balance ad for a new product" without naming a specific SKU,
   the agent's job in Phase 1 is to **find a real specific product**:
   query the brand's product catalog via brandwork, OR run
   `brandwork web fetch <brand-domain>/new-arrivals` (or the brand's
   actual landing page) and identify a real SKU, real colorway, real
   price, real positioning copy. Record SKU + URL + every line of
   copy the brand publishes about that product in `strategy.md`. The
   spot uses those exact words and the actual product image — no
   invented colorways, no invented capsule names, no invented copy.

3. `brandwork brand.ads domain=<x> source=meta limit=10` — what the
   brand's actual published ads look like. Pull at least 2 real ad
   creatives (text bodies + sample frame URLs from `snapshot.body
   .text` and `snapshot.images` / `snapshot.videos`). The screenplay
   MUST reference how those ads structure their hook, social proof,
   CTA, and product reveal — the agent's training-data prior on
   "what a brand ad looks like" is downstream of this real data.

4. **Logo retrieval is hard-required, no fallback.** `brand.brief`
   returns a `brand.logo_url`. The agent MUST `curl` that URL and
   confirm the asset downloads (HTTP 200, content-type image/svg+xml
   or image/png, body > 1KB). If the logo_url is missing or 404s,
   the agent MUST escalate (not fall back to rendering the brand
   name in a sans-serif placeholder): use `brandwork web fetch
   <brand-domain>` to scrape the site's `<link rel="icon">` /
   `<meta property="og:logo">` / Open Graph image, OR query
   `brandwork brand fetch <domain> --force-refresh` to re-pull from
   logo.dev / Brandfetch. Every brand we've used has a real logo
   available through one of these paths. If after all four paths
   nothing resolves, **STOP and surface the error to the user** —
   do NOT proceed with content generation. Rendering the brand
   name as filler typography in place of the real wordmark is a
   ship-blocking failure.

If the agent declares Phase 1 done without these four calls landed,
the logo asset downloaded, and a real product researched, the spot
WILL be generically wrong regardless of how good the Veo prompts
are. The rubric's `brand_resolution` dimension grades this;
`wavelet lint` cannot catch it because the failure is upstream of
layout.

Anti-patterns observed in eval traces (don't repeat):
- 005 v5 (Whirlpool): zero brandwork calls. Worked from training-
  data priors, wrote "Whirlpool iconic stand mixer in pearl white"
  when the real product brand is KitchenAid.
- 008 v2 (NB 9060 Mint Julep): brandwork calls landed, but the
  agent invented "Acrylic Series" / "A New Balance Capsule" /
  "Pigment 001" / "MACRO 005" / "100MM · F/2.8" copy that has no
  basis in NB's real product line. Never showed the NB wordmark
  even though `brand.logo_url` was retrievable. Used filler black
  sans-serif type for "NEW BALANCE" instead of pulling the real
  wordmark asset.
- 010 v3 (Bubble): brandwork returned real product data (turquoise
  jar with orange pump cap), agent wrote "pastel pink-and-cream
  squeeze tube" anyway. Verbatim copy propagation discipline
  failed at the prompt-authoring step.

## Hard rules — apply to EVERY spot regardless of register

These are NOT register-specific stylistic guidance — they apply to
every commercial Wavelet ships. They exist because each one has been
violated in production evals (008 v2, 010 v3) and the failure mode
is invariably "the ad looks slick but is brand-wrong."

### 1. No invented product taxonomies

Never introduce a product line name that isn't in the brief or
brandwork output. "Acrylic Series", "Pigment 001", "Capsule",
"Edition N" etc. are filler-fashion vocabulary that the LLM reaches
for when it feels a premium register. They are wrong unless the
brand actually publishes under that line — and you'll know because
`brandwork brand.product` or `brand.ads.meta.[].snapshot` will name
them. If neither does, the line doesn't exist; do not invent it.

### 2. Brand wordmark required in intro + CTA

Every spot opens AND closes with the brand wordmark on screen. Pull
from `brandwork brand.logo_url` and inline as an `<img>` or
`<wavelet-clip>` over the underlay. If `logo_url` is absent for the
brand, render the brand name in the brand's canonical face from
`brandwork design.typography.headings.h1.fontFamily` — NEVER as
filler black sans-serif. If even that's missing, stop and run
`brandwork brand` again until you have either the logo or the
canonical type. A spot without the wordmark is not the brand's spot.

### 3. Product visible by 3s

The first sustained shot containing the actual product MUST be ≤ 3s
into the spot. A 1-2s opener of abstract motion or type cards is
fine, but the product cannot be absent for the opening 5+ seconds.
Real social ads at this length (12s-30s) establish product + brand
by 2-3s; anything longer reads as untargeted brand-art rather than a
shoppable ad. 008 v2 left the NB 9060 invisible for the first ~12s
of a 25s spot and the resulting render reads as a paint commercial
that happens to have shoes in it.

### 4. Real metadata only — no decorative fake garnish

Lens specs (`100MM · F/2.8`), hex codes (`#B8DCC8`), frame numbers
(`MACRO 005`), fake series taxonomies, and similar editorial-cover
typography garnish are BANNED on type cards unless:

- The brand's actual published ads (visible in `brandwork brand.ads`)
  use them, AND
- The metadata is real (the actual lens used, the actual product
  code, the actual colorway name from `brand.product`).

CSS hex codes used for typography decoration ("#B8DCC8" on a card
because the mint is hex `#B8DCC8`) are the canonical tell. They
carry meaning to the prompt author, none to the viewer. Strip them.

### 5. Premium-minimal is the default register, NOT editorial-spread

The "cinematic / luxury / editorial" register bucket has historically
covered two distinct schools:

- **premium-minimal** (Apple, Nike, Common Projects): brand-first,
  product-first, real type, no invented taxonomies, no fake metadata.
  This is the **default** for any brief that names a product to sell.
- **editorial-spread** (Apartamento, 032c, Hypebeast magazine
  pages): off-white grounds, serif-sans mix, real metadata-as-craft
  (real lens, real designer, real edition number). Use ONLY when the
  brief explicitly asks for magazine-spread aesthetic AND the brand's
  own ads live in that space.

When in doubt → premium-minimal. The editorial register is a narrow
opt-in. The 008 v2 failure was reaching for editorial vocabulary
without the brief asking for it.

### 6. Pre-flight: read ≥2 real ads before writing the screenplay

Before drafting any shot prompt or type card copy, run:

```
brandwork ads search <brand>
```

Read the body + title of at least two actual creatives from
`brand.ads.meta.[].snapshot.body.text` and `snapshot.title`. The
screenplay's voice, type, and product framing should match what the
brand actually publishes. Skipping this step is what produced the
"confused mimicry" copy in 008 v2 — the agent's prior of what a
"premium NB ad" should look like was wrong.

## Shot-prompt-prefix — locking the visual register

Every freshly-spun director writes one bespoke Veo prompt per shot,
each with its own ad-hoc cinematography vocabulary. The result is
three shots that read as three different cameras: shot 1 a moody dawn,
shot 2 bright clinical daylight, shot 3 rustic warm tones. The `color-
grade-coherence` lint catches the symptom (worst-pair deltaE in the
high 30s) but the fix lives upstream, at the storyboard stage.

In Phase 1 (creative strategy), lock a single **cinematography
preamble** — a 15-40 word block declaring the shared visual language
for THIS spot. Record it in `strategy.md` under a `Cinematography
lock` heading. Examples of what a locked preamble looks like:

> 35 mm anamorphic, shallow DoF, amber tungsten key from camera-right,
> A24-style color grade with warm shadows + neutral highlights, soft
> film grain, no LUT shift, locked aspect 9:16

Use the next register when the brief leans social-feed, DTC, lifestyle,
or authenticity-first rather than cinematic luxury — the camera is
supposed to feel like a phone someone is actually holding, not a film
rig:

> handheld iPhone 16 Pro Max at chest height, quick punchy cuts on
> action, energetic feed pace, raw camera-native HDR with no color
> grade, slight rolling-shutter wobble, no anamorphic flare, no film
> grain overlay, ambient daylight + practical room light

> iPhone 16 Pro Max handheld at chest height, available daylight
> overhead, Apple HDR color, slight rolling-shutter wobble, no color
> grade beyond camera-native, 9:16 portrait

### UGC talking-head register — the canonical selfie scaffold

The above preambles describe a *camera*. For a creator-to-camera UGC
ad (the "filmed on an iPhone in a bathroom" aesthetic), the prompt
also needs an explicit *selfie framing* opener. Community-validated
findings (Replicate Veo 3 guide, snubroot/Veo-3-Prompting-Guide,
Atlabs, AdLibrary, shedoesai — 2025-2026): every UGC prompt MUST
open with the literal phrase **"A selfie video of"** followed by
identity, and MUST include the literal **"holds the camera at arm's
length. Her arm is clearly visible in the frame."** beat. Without
both, Veo collapses to a close-up portrait, not a selfie.

The preamble for this register, pasted verbatim after the subject /
action / wardrobe slots on every shot:

> handheld iPhone 16 Pro Max selfie, arm clearly visible in lower
> frame, eye contact with the lens, natural available daylight from
> camera-left, Apple HDR camera-native color (no LUT, no grade),
> slight rolling-shutter wobble, slightly grainy, looks very film-
> like, ambient room sound, 9:16 portrait

Concrete shot prompt for shot 1 of a 24 s skincare-haul talking-head
spot — note the opener and the arm beat are *literal*, the trailing
realism modifiers are *literal*, and the cinematography preamble is
the constant across every cut:

```
A selfie video of DANA, a 23-year-old with light brown hair tied
in a messy half-up, freckles, visible pores, asymmetric features,
no makeup, cream cotton tank top with wrinkled fabric, standing at
her bathroom vanity with morning daylight from a frosted window
camera-left, holds the camera at arm's length, her arm is clearly
visible in the frame, looks into the lens and says brightly in a
natural American accent: "okay so I literally just tried this and
my skin is, like, glowing", handheld iPhone 16 Pro Max selfie, arm
clearly visible in lower frame, eye contact with the lens, natural
available daylight from camera-left, Apple HDR camera-native color
(no LUT, no grade), slight rolling-shutter wobble, slightly grainy,
looks very film-like, ambient room sound, 9:16 portrait
```

Dialogue conventions for the register: filler words ("like",
"literally", "um", "okay so"). Conversational sentence fragments.
Mannerisms in the action slot ("covers her mouth", "rolls her eyes",
"glances offscreen"). NO corporate copy, NO "today I want to tell
you about", NO "introducing the all-new". One continuous take, no
cuts mid-shot.

### UGC negative-prompt set

For UGC-register shots, override the standard negative prompt with
the community-validated 5-8 term set (Magic Hour, videoai.me,
AdLibrary — research findings cap effective negative length at
~8 terms; longer lists measurably degrade output). Pass via
`--negative-prompt`:

```
plastic skin, frozen lips, jittery eyes, unnatural blinking,
floating teeth, head shake, studio lighting, ring light, beauty
filter, perfect skin, heavy makeup, DSLR, professional photography,
centered framing, stock photo
```

Trim to 5-8 most-relevant terms per shot. Keep `plastic skin`,
`frozen lips`, `jittery eyes` in every UGC shot — those are the
identity-stability anchors that prevent the AI-face tell.

### Pick the concept — the four creative buckets

Every spot lives in one of four creative concepts. These are
**vibe directions, not prompt-deterministic categories** — you pick
one based on the brief, the brand's actual published ads, and the
goal of the spot. Two spots in the same concept can read very
differently, but everything about how you author the screenplay,
where you put text, and how you pace cuts is downstream of which
concept you picked. **Pick exactly one and commit to it in
`strategy.md` under a `Concept` heading. Don't mix.**

#### 1. Organic

The "I'm watching this on TikTok / YouTube Shorts / Reels" vibe.
Creator-to-camera, talking-head, lo-fi handheld feel, real-life
environment (bathroom, kitchen, walking through a store). UGC is
the dominant sub-style here.

Authoring rules:
- Backend: Nano Banana 3 for character refs, Veo 3.1 ref-to-video
  for shots. See "UGC talking-head register" scaffold above.
- Text: HTML overlays only for brand wordmark + CTA — keep Veo
  clips text-free since baked text reads as AI artifact in this
  register.
- Pacing: longer single takes (4-8s), eye contact with lens,
  natural filler words in dialogue.
- Length: 18-30s typical; UGC viewer expects a story arc.
- Brand visibility: brand wordmark as small HTML pill in corner;
  product visible in-frame from shot 2 onward.
- Post: ffmpeg post-realism pass (Step 8.7) for the phone-camera
  authenticity layer.

When the brand's Meta ads are predominantly creator-shot talking-
heads → this is your concept by default.

#### 2. Direct Response

True advertising. Hook + social proof + CTA in a strategized order.
The viewer should know the brand, the product, the value
proposition, and where to buy within the first 5s, with conversion
mechanics doing real work the rest of the way.

Authoring rules:
- Structure (mandatory): hook in first 2s, social proof / demo
  in middle, hard CTA in final 3s. The screenplay must explicitly
  label these scenes.
- Hook: pattern-interrupt motion + brand identifier on screen.
- Social proof: real review snippet (pull from `brandwork brand
  .ads` examples), real founder testimonial, real before/after.
  Never invented quotes.
- CTA: HTML scene with brand wordmark + headline + button +
  URL. See "CTA mode — direct-response" section.
- Brand visibility: wordmark visible by 2s, product visible by 3s.
  No 5-second cold opens with abstract motion.
- Backend: depends on the visual register the brand's existing
  ads use — could be UGC (Nano Banana refs + Veo) or cinematic
  (Veo only). Look at `brand.ads` for guidance.
- Text inside Veo gen: only if the brand's real ads use baked
  text (rare); default is HTML overlays for all on-screen copy.

When the brief uses words like `conversion`, `DTC`, `sale`,
`offer`, `discount`, `launch`, or names a specific funnel stage
("retargeting," "TOFU") → this is your concept.

#### 3. Animated

Eye-popping visual aesthetics. The medium IS the message — fluid
color, viscous paint, kinetic typography, transitional animations,
forming-from-motion wordmarks. Not trying to look real; trying to
look beautiful.

Authoring rules:
- Backend: Veo 3.1 (no ref-to-video needed — the subject is the
  medium, not a person). For complex multi-shot motion, evaluate
  Kling v3 Pro's multi-shot mode (tracked under `wb-qkgj`).
- Pacing: **fast cuts, ≤ 2s per shot typical**, transitions
  matched between shots (paint at end of shot 1 becomes paint at
  start of shot 2 — the cut is invisible because the medium
  carries through).
- **Text goes INSIDE the Veo generation, not as HTML overlay.**
  Prompt the brand wordmark to form from the medium ("the words
  NEW BALANCE materialize from the swirling acrylic"). HTML
  overlays in this register undercut the aesthetic.
- Product visible: yes, but stylized — the product can be the
  paint, made of the medium, dripping with the medium. Pure
  abstract motion without product reveal by 8s is a fail.
- Brand wordmark: must appear in real brand typography pulled
  from `brandwork design.typography.headings.h1.fontFamily` —
  not invented sans-serif. Render via Veo prompt or by
  pre-rendering the wordmark as PNG and feeding it as a Veo
  reference image (Ingredients-to-Video, one of the 3 ref slots).
- Length: 15-30s; longer than ~30s is hard to sustain visually
  without becoming tedious.

When the brief says `acrylic`, `liquid`, `paint`, `kinetic`,
`motion graphics`, `animated`, `abstract`, `viscous`, `fluid`,
`transitions`, `typographic`, or is about visual texture/medium
rather than people → this is your concept.

#### 4. Cinematic

High-quality lifestyle footage. Vibey, emotional, focused on the
*feel* of using/wearing/being-around the product. NOT organic
(it's polished), NOT direct response (no hard CTA structure),
NOT animated (it's real-world footage, not abstract motion).

Authoring rules:
- Backend: Veo 3.1 standard (not fast) for hero shots, $0.50/s ×
  4-8s. Optional Nano Banana 3 character refs if recurring people.
- Pacing: 3-6s per shot, deliberate breathing room, ambient sound.
- Visual register: 35mm anamorphic or 50mm prime preamble (see
  "Cinematography lock" section). Shallow DOF, warm color grade,
  golden-hour or interior practicals.
- Text: HTML overlays minimal — wordmark in corner, maybe one
  positioning line at the end. The aesthetic does the selling.
- Brand visibility: wordmark visible by 3s; product hero shot
  by ~10s into a 25s spot.
- Emotion-first: the script is a feeling, not a feature list.

**Editorial is a narrow opt-in sub-style here**, not a default.
Use it ONLY when the brief explicitly asks for luxury / lifestyle
editorial (off-white, Apartamento / 032c / Hypebeast magazine-
spread typography), AND the brand's actual ads use that
vocabulary. Don't reach for editorial because the brand "feels
premium" — premium brands like Apple and Nike use cinematic
minimalism, not editorial. Editorial-specific notes:
- Off-white / cream backgrounds, deep maroon or charcoal type.
- Serif/sans mix on type cards.
- Real metadata only (real product code, real colorway name) —
  no fake lens specs, no hex codes as captions, no invented
  series taxonomies. The 008 v2 trap was reaching for editorial
  vocabulary without the brief asking for it.

When the brief uses words like `cinematic`, `lifestyle`,
`emotional`, `aspirational`, `premium`, `vibey` → this is your
concept. Default for car ads, fashion lookbooks, hospitality,
high-end consumer.

#### Picking when ambiguous

If the brief doesn't make the concept obvious, fall back in this
order:
1. What concept do the brand's actual published ads
   (`brandwork brand.ads`) live in? Match that.
2. What concept does the medium imply? (Talking-head footage →
   organic. Paint/abstract → animated. Polished real-world →
   cinematic. Hook+CTA-shaped → direct response.)
3. Ask the user.

Don't pick by genre/brand-vertical priors — a car ad isn't
automatically cinematic, a skincare ad isn't automatically
organic. Look at what the brand actually publishes.

> Studio product-on-pedestal, single key light from top-front at 45
> degrees, deep shadow on right, warm tungsten 3200K, glossy black
> sweep, slow rotational push-in, 9:16 portrait

Every `wavelet shot txt2vid` prompt is then `<scene-specific subject +
action>` + `, ` + `<cinematography preamble pasted verbatim>`. The
preamble is the constant; only the subject/action varies between
shots. Veo (and any modern text-to-video model) keys heavily on
cinematographic vocabulary — repeating "35 mm anamorphic, A24-style
color grade, amber tungsten key" across every shot forces Veo into
the same visual register every time. The cuts read as one shoot, not
three commercials stitched together.

Worked example (Whirlpool / KitchenAid stand mixer, premium kitchen,
warm morning light). Strategy.md carries:

```
## Cinematography lock

50 mm full-frame, medium-close framing, warm morning window light
camera-left at 3200K, deep brown-and-cream palette, gentle film grain,
A24 domestic-warm grade, locked 9:16 portrait
```

Shot 3 prompt — "macro of dough folding over the hook" — is then
constructed as:

```
Macro: dough folds over the spiral hook as the mixer turns at low
speed, 50 mm full-frame, medium-close framing, warm morning window
light camera-left at 3200K, deep brown-and-cream palette, gentle film
grain, A24 domestic-warm grade, locked 9:16 portrait
```

Every other shot's prompt ends with the same comma-prefixed clause,
character-for-character. No paraphrasing, no synonyms.

The lock breaks only for a deliberate transition — a flashback in
different stock, a dream sequence in different grade. If you break
the lock on purpose, note which shots break and why in `strategy.md`
so the `color-grade-coherence` lint's finding is interpretable. The
lint will fire; the strategy doc is what tells the reviewer the fire
was intentional.

## Shot count and pacing — break the 3-clip default

The default failure mode for a freshly-spun director is 3-4 shots at 4 s
each for a 12 s spot. That cadence reads as corporate stock footage —
the 005 v4 run produced exactly this pattern and Shane called it out
verbatim: "feels like slow stock footage style every time." Three slow
clips strung together with crossfades is the AI-default look. Avoid it
on every spot that isn't an explicitly meditative / luxury register.

### Corrective default — 12 s spot, 6-8 cuts

- Aim for 6-8 cuts, average shot length 1.5-2 s.
- First shot ≤ 1.5 s — this is the scroll-stop hook. If it doesn't work
  as a thumbnail, it doesn't work.
- Last shot can run longer (2-3 s) if it's a CTA card or wordmark hold.
- One shot of "rest" (2-3 s) is fine mid-spot for breathing; everything
  else should be tighter.

### Shot duration math relative to Veo

Veo accepts integer durations from `{4, 6, 7, 8}` seconds, so a single
`wavelet shot txt2vid` call always produces ≥ 4 s of footage. Three
strategies for fitting more cuts than Veo calls:

- Use the FIRST 1-2 s of a Veo clip and discard the rest — the
  `cuts.edl` from `wavelet velocity validate` trims each clip to its
  used window. Many short cuts can come from few Veo calls.
- Run more Veo calls at minimum duration (4 s). Costs more, but every
  cut is generated with intent for its own moment.
- Mix: 2-3 hero Veo calls at 4 s held in full, plus 4-5 quick cuts
  trimmed from a single longer Veo call. At veo-lite ($0.40 per 4 s)
  the 005 budget fits 8-10 calls comfortably.

### Worked KitchenAid example — 12 s, 7 cuts

- `0.0-1.2 s` — close-up: dough hitting the bowl (impact, hook)
- `1.2-2.5 s` — hands clicking the tilt-head down
- `2.5-4.5 s` — macro: dough hook rotating, dough catching shape (the
  only "rest")
- `4.5-6.5 s` — bowl rotation, dough forming
- `6.5-8.5 s` — pulling the finished loaf from the oven
- `8.5-10.0 s` — wide of the bread on the table
- `10.0-12.0 s` — CTA card (wordmark + button)

Hard cuts throughout. Every Veo prompt shares the UGC preamble (see
Shot-prompt-prefix). Total veo-lite cost ≈ 7 × $0.40 = $2.80; fits the
$5 budget with $2 headroom for music + retries.

## CTA mode — direct-response vs lifestyle

### Hard rule — the CTA scene is HTML, not a Veo clip

The last scene in a direct-response spot is ALWAYS an HTML
composition file (e.g. `scenes/07-cta.html`) with these required
elements:

- `<img src="<real-logo-url-from-brandwork>">` — the brand logomark
  or wordmark URL pulled from the `brandwork brand.brief` response's
  `logo_url` field. Never text-render a wordmark unless the brand is
  wordmark-only with no logomark.

  **DO NOT fetch `/apple-touch-icon.png`, `/favicon.ico`, `/favicon.png`,
  `<link rel="icon">`, or any `manifest.json` icon as the brand logo.**
  Those are 192×192 app-launcher icons — they are NOT the wordmark.
  Using one as the CTA logo is a known failure mode (005 v5 fetched
  `kitchenaid.com/apple-touch-icon.png` and rendered a generic "K"
  square in every cut).

  **If `brandwork brand.brief` does not return a `logo_url`** (today, it
  often doesn't), fall back to CSS-typeset brand text in the brand's
  wordmark font — `<h1 class="wordmark">KitchenAid</h1>` with
  `font-family: "Helvetica Neue Black", Helvetica, Arial Black,
  sans-serif; font-weight: 900; letter-spacing: -0.02em;` (substitute
  the brand's actual wordmark family when known). A textual lockup
  reads as deliberate; a favicon reads as a bug.
- One CTA line, ≤ 7 words and ≤ 40 characters, authored as
  CSS-typeset HTML text — not baked into a generated image.
- One real `<button>` element with CSS styling. Not a `<div>` styled
  like a button. Not an `<img>` of a button.
- Optional URL text or a `<canvas>`-rendered QR beneath the button.
- A background — either the brand's palette swatch (from `brandwork
  brand.brief` `palette_json`), a still product image (from `brandwork
  brand.product`), or the last Veo shot frozen as a still.

Veo clips do NOT belong in CTA scenes. A Veo-generated "studio
product photography" clip used as a CTA is a v5-style failure mode
that conflates "asset generation" with "creative direction." The CTA
scene's HTML simply omits the inline `<video>` element — it's
HTML-only on a solid-color or gradient background, no Veo underlay.

**Do not spend Veo credits on the CTA.** A standard CTA is solid
color matte + HTML/CSS overlay — wordmark + headline + button +
optional URL. No video gen needed. If you find yourself prompting
`shot txt2vid "studio product photography for CTA…"`, STOP. That's
~$1 per attempt for an asset that should be pure HTML.

Lifestyle mode (the alternative): no separate CTA scene at all. The
last shot of the spot just IS the last beat, and a small wordmark
bug may appear as an HTML overlay element inside the previous
scene's HTML. Still no Veo "CTA" clip.

**CTA URL discipline — pull from brandwork, never invent.**
The URL on the CTA card MUST be the `domain` field from
`brandwork brief <domain>` or `brandwork brand fetch <domain>`. Read
the JSON output, find the `brand.domain` (or top-level `domain`)
field, paste it into the HTML verbatim. Common failure mode: agent
re-reads its own brief.md and writes a "rememembered" version of the
domain (e.g. `hellobubble.com` when brandwork returned
`bubbleskincare.com`). That ships a CTA that goes nowhere. Cross-
check the CTA scene's URL against the brandwork JSON before render.

Worked example for KitchenAid (direct-response mode):

```html
<!-- scenes/07-cta.html -->
<div class="cta">
  <img src="https://media.brand.dev/<...>/kitchenaid.svg" class="wordmark">
  <h2>The icon. For your kitchen.</h2>
  <button class="primary">Shop at KitchenAid</button>
  <p class="url">kitchenaid.com</p>
</div>
<style>
  .cta { background: #ffffff; display: grid; place-items: center; gap: 32px; height: 100vh; }
  .wordmark { width: 60vw; }
  .primary { background: #c8102e; color: white; padding: 24px 48px; border: 0; font-size: 36px; border-radius: 8px; }
  .url { font-size: 28px; color: #333; }
</style>
```

Real logo URL from brandwork, CSS button, brand color from the
palette. No Veo.

A last-shot CTA card (brand wordmark + tagline + button) is right for
some commercials and wrong for others. A Liquid Death shock-comedy
spot doesn't end with "BUY NOW"; a Whirlpool / KitchenAid direct-mail
spot probably does. Decide once, in Phase 1's brand-research step —
not in the director recipe and not at compose time.

During `brandwork brand.brief <domain>` + `brandwork ads`, inspect the
brand's published ads and apply this rule:

- If brand ads lean heavily on "buy now / shop the link / use code
  XYZ / link in bio" copy → **direct_response**
- If brand ads lean on aspirational / mood / "available where good X
  is sold" without explicit conversion CTAs → **lifestyle**
- When in doubt, **lifestyle**. Out-of-context CTAs feel like spam;
  missing a CTA on a lifestyle brand is invisible.

Record the decision in `strategy.md` under a `CTA mode` line, with
the reason:

```
CTA mode: direct_response — reason: 3 of 5 sampled KitchenAid Meta
ads end with "Shop now" / "Use code BAKER15"
```

### Direct-response mode

- Last 1.5-2 s of total runtime is a dedicated CTA card.
- Brand wordmark animates in. **Use the real logo URL** from the
  `brandwork brand.brief` response — never fabricate the wordmark or
  text-render it in display type, unless the brand has only a
  wordmark (no logomark) and you're using the brand's actual
  typeface.
- One-line CTA copy, ≤ 7 words and ≤ 40 characters: "shop the iconic
  stand mixer", "use code BAKER15", "available at every Whole Foods".
- One button — real CSS or inline SVG, never an image-of-a-button.
  White rounded-rect with brand-colored fill, or brand-colored fill
  with white text. Touch-target sized (≥ 88 px tall at 1080×1920).
- Optional URL or QR code beneath the button for offline-viewable
  contexts (out-of-home displays, embedded video, screenshots).
- The card still respects the 9:16 platform safe zones — keep the
  button and URL above the bottom 320 px on TikTok, etc. `wavelet
  lint --platform <p>` catches violations if you forget.

Direct-response example, KitchenAid Whirlpool stand mixer: last 2 s
holds the animated wordmark, the line `AT THE HEART OF HOME` set in
the brand's display face, a `Shop the iconic mixer` button (cream
fill on the brand's signature red), and `kitchenaid.com` set small
beneath the button.

### Lifestyle mode

- Last shot stays atmospheric — same cinematography preamble as the
  rest of the spot, no register break.
- Brand wordmark MAY appear as a small bug in a corner, ≤ 8 % of
  canvas height, animated subtly (fade-in only, no slide / no
  bounce).
- NO button, NO "shop now", NO URL, NO QR.
- Optional one-line tagline — the brand's actual slogan from
  `brandwork brand.brief` — set in the same display type as the rest
  of the spot, sized for in-feed legibility (cap-height ≥ 56 px at
  1080×1920 per the text-readability lint).

Lifestyle example, Liv Conscious wellness: last shot stays cinematic
on the product, the `Liv Conscious` wordmark fades in lower-left at
5 % of canvas height, 14 px wordmark icon next to it, no button, no
URL, runtime carries on the visual register the rest of the spot
established.

## Step 1 — pick a concept and write the 9-line brief

A 10-15 second commercial works best. Good fits:

- A consumer brand without specific logo demands (coffee, fragrance,
  EV concept, watch, travel)
- A travel destination
- A non-profit cause / public service spot

Avoid:

- Real people with dialogue (no lip-sync yet)
- Specific brand logos (Veo will hallucinate them poorly)
- Products that need close-ups of small written details
- Anything requiring text legibility in the generated footage

### The 9-line ad creative brief

Don't write prose. Write `brief.md` in the **9-line slot-filled
format**. One slot per line, in any order:

| Slot       | What it captures                                       |
|------------|--------------------------------------------------------|
| `PRODUCT`  | What we're selling — one noun phrase                   |
| `AUDIENCE` | Who the spot is for — specific demographic, not "everyone" |
| `INSIGHT`  | What they currently believe/feel that the brand wants to shift |
| `PROMISE`  | What the brand says it will deliver                    |
| `PROOF`    | One concrete reason to believe the promise             |
| `TONE`     | Single-word aesthetic register (e.g. `cinematic`, `irreverent`, `brutalist`) |
| `MUSIC`    | Genre + energy curve (e.g. `ambient build → driving electronic peak`) |
| `CALL`     | What the viewer should do — CTA in 1-5 words           |
| `RUNTIME`  | Target duration in seconds (integer)                   |

Worked example (`brief.md`):

```markdown
PRODUCT: Allbirds Tree Runner sneakers
AUDIENCE: 28-40 urban professionals who walk more than they run
INSIGHT: "Sustainable" usually means uncomfortable or ugly
PROMISE: All-day comfort that happens to be made from trees
PROOF: Eucalyptus-fiber upper + sugarcane sole, machine washable
TONE: understated
MUSIC: acoustic minimal → warm indie-folk swell
CALL: Try them barefoot
RUNTIME: 15
```

Validate before continuing:

```bash
wavelet brief check brief.md
```

Long-form briefs are still acceptable as input. When a human hands you a
prose brief, distill it into the 9-line shape *before* moving to step 2.

## Step 2 — write the screenplay

Fountain format (`.fountain`). 4-6 scenes, mostly action paragraphs.
Match the screenplay's pacing to the commercial: short punchy action =
fast cuts; long flowing description = slower scenes.

```fountain
Title: <product>
Author: wavelet-director

EXT. SAGUARO FIELD - DAY

A giant cactus stands sentinel against the morning sky.

CUT TO:

EXT. SLOT CANYON - DAY

Light cuts through the narrow walls of red stone.

CUT TO:

EXT. SEDONA VISTA - SUNSET

Cliffs glow as the sun drops behind the ridge.

CUT TO:

EXT. DESERT ROAD - NIGHT

Headlights cut a path through the silence.

FADE OUT.
```

Save to `script.fountain`.

### Step 2.5 — copy-budget gate (`wavelet screenplay validate`)

Before moving to storyboard, validate that the script's copy density
fits the declared duration. Over-stuffed copy is the most common
pre-flight failure — it doesn't get fixed by better cuts or better
shots, because the message physically can't be delivered in the time
available.

```bash
wavelet screenplay validate script.fountain --duration 12 --pretty
```

Exit 0 = script fits within ±10% of the declared duration. Exit 3 =
`over_budget`; refuse to advance. The pipeline gate
(`screenplay_duration_fits`) blocks the storyboard stage until the
validate call exits 0.

**Copy budget by duration** — keep total copy under these counts
unless you genuinely have a hook that can sustain a denser read:

| Duration | VO words max | Captions max | When over |
|---|---|---|---|
| 6s  | 15 | 1-2 | icon-led, ≤1 line VO |
| 10s | 25 | 2-3 | strong visual hook |
| 12s | 30 | 2-3 | the typical Reels target |
| 15s | 38 | 3-4 |  |
| 20s | 50 | 4-5 | full claim+benefit+CTA fits |
| 30s | 75 | 5-6 | comfortable narrative arc |

**Decision tree when validate fails:**

1. **Cut copy first.** Most "must say" claims are author indulgence;
   the viewer reads the visual. Trim VO to the hook + the proof + the
   ask. Three beats, not seven.
2. **Lean visual.** If the message is genuinely visual (icons,
   product, expression), drop VO and let on-screen icons + a short
   caption do the work over a music bed. Stacking VO + reading lets
   you carry more information per second, but only if the VO and the
   captions are NOT saying the same thing.
3. **Extend duration.** Only when the brief permits. Bumping a 12s
   spot to 20s is usually a re-spec, not a fix.

## Step 2.7 — character refs for identity consistency across cuts

If the brief calls for the **same person** to appear across multiple cuts
(UGC, talking-head, lifestyle with a recurring actor), Veo's identity
drift is the #1 failure mode. Lock characters with reference images
*before* storyboard planning runs.

Two-step authoring:

1. **Pick one reference image per face you need.** A clean front-facing
   still works best. **Backend choice depends on the register:**

   - **UGC / TikTok talking-head / creator-to-camera ads** —
     `wavelet shot still --backend google-nano-banana-3` (the default
     `still` backend; no flag needed). Nano Banana 3 natively
     handles `"iPhone UGC style"` / `"TikTok aesthetic"` cues and
     bakes in convincing-amateur skin texture, asymmetric features,
     visible pores, and on-purpose imperfection — exactly the
     ingredients Veo 3.1 needs to extend the clip as a real creator
     instead of an AI portrait. ~$0.04/image. Community research
     (r/aivideo, Magic Hour, Atlabs, AdLibrary, ugcmaker.org —
     2025-2026) is unanimous that Flux Schnell's symmetric polished-
     portrait baseline poisons downstream UGC video gen.
   - **Cinematic / luxury / non-UGC photoreal portraits** — also
     `google-nano-banana-3` (the default). Nano Banana 3 handles the
     clean studio headshot register just as well as Flux Schnell does
     and produces better identity coherence + skin texture, so there's
     no register that wants Flux as the actual default. Cost delta over
     a 3-4 ref eval is ~$0.15 — negligible vs Veo's per-shot spend.
   - **`fal-flux-schnell` is opt-in only** — keep it available for
     cost-constrained variant batch-rolls (e.g., generating 20 candidate
     portraits at $0.003 each before promoting a winner to Nano Banana
     re-roll), or when nano-banana is rate-limited. Don't reach for it
     as the default character-ref path.

   For ECU hand cutaways, capture a **separate** hands-only reference
   — face-conditioning leaks into hand quality if reused.

   **How to author the reference image — isolated subject, not in-scene.**
   Google's docs are explicit that the role of a reference image is to
   "preserve the subject's appearance in the output video," and every
   example on the Gemini API page uses product-style photography on a
   plain backdrop (see <https://ai.google.dev/gemini-api/docs/video>).
   The 010 eval generated face refs with the bathroom window, beige
   wall, and towel bar baked in — Veo treated those props as identity
   features and re-rendered them across every cut. Don't do that.
   Generate refs as **isolated-subject portraits against a neutral
   backdrop**, never as in-scene compositions. Concrete prompt
   templates for the underlying `wavelet shot still` call:

   ```text
   studio portrait headshot, [SUBJECT], neutral light-grey backdrop,
   soft front light, no environment, no props, no scene context, eye
   contact with camera, sharp focus, 9:16 portrait, photorealistic
   ```

   **UGC variant — when the brief is a talking-head TikTok / Reels
   creator ad.** The neutral-backdrop studio still above produces too-
   symmetric "AI portrait" identity priors that Veo 3.1 then extends
   as obvious-AI footage. For UGC, generate the ref with imperfection
   cues baked in. Still keep it isolated (no full scene context — the
   bathroom-wall / towel-bar leak from the 010 eval still applies),
   but lean into the iPhone-selfie register:

   ```text
   iPhone UGC style selfie still, [SUBJECT], 23-year-old, light
   brown hair slightly messy, freckles, visible pores, asymmetric
   features, uneven skin tone, no makeup or no-makeup-makeup,
   neutral light-grey backdrop, natural ambient daylight from
   camera-left, eye contact with camera, casual cotton tank top,
   wrinkled fabric, slightly grainy, 9:16 portrait, photorealistic,
   not retouched, not a professional headshot
   ```

   Negative prompt for the ref still:
   `studio lighting, beauty filter, perfect skin, ring light, DSLR,
   makeup, retouched, symmetric, model headshot, glamour photography`.

   The principle: every imperfection in the still is an imperfection
   Veo 3.1 will preserve when it ref-conditions the talking-head clip.
   You are pre-loading the "real creator" identity prior. See the
   "UGC talking-head register" cinematography preamble below for the
   matching shot-prompt scaffold.

   And for hands:

   ```text
   hands isolated against neutral grey backdrop, [HAND DESCRIPTION +
   PRODUCT IF ANY], soft diffuse light, no environment, no scene
   context, macro framing, sharp focus, 9:16 portrait, photorealistic
   ```

   Use an opaque grey backdrop, **not** a transparent PNG —
   text-to-image models render transparency literally (checkerboard,
   alpha noise, or a fabricated background filling in the void) rather
   than reading it as "no background." A solid neutral grey is the
   least likely to leak into the downstream Veo generation.

   **Aspect ratio for refs — pass `--image-size` explicitly.**
   The text "9:16 portrait" in the prompt body is a hint, not a
   constraint; Flux Schnell defaults to landscape and will return
   1024×576 unless told otherwise via the `--image-size` flag. The
   useful enum values:
   - `portrait_4_3` — 768×1024 (3:4). Close enough to 9:16 for ref-
     conditioning purposes; safe default for face/hands refs.
   - `portrait_16_9` — 720×1280 (9:16 vertical, named by Fal as
     "16:9 rotated"). Use when you need true 9:16.
   - `square_hd` / `landscape_4_3` / `landscape_16_9` — non-vertical;
     don't use for character refs.

   Veo 3.1 reads any aspect ratio for the conditioning image, so
   `portrait_4_3` is fine; the value matters more for downstream
   compositing (when the ref shows on-screen as a Ken Burns layer).
   Pass `--max-cost 0.01` minimum — Flux Schnell is $0.003/image but
   the default budget is $0, so without the flag you get
   `exit 3: estimated cost $0.005 exceeds budget $0.0000`.

   Veo 3.1 ref-to-video accepts at most **three** reference images per
   call (Google Gemini docs cap, same source as above). Plan refs
   accordingly: typically one face + one hands + optionally one
   product-hands.
2. **Register each character** by Fountain CHARACTER cue (uppercase
   normalized — `ALEX`, `ALEX (V.O.)` and `Alex` all collapse to
   `ALEX`):

   ```bash
   wavelet character define ALEX --reference ./alex-face.jpg \
     --character-type full-body
   wavelet character define ALEX --reference ./alex-hands.jpg \
     --character-type hands
   ```

   The flag is `--character-type` (NOT `--type` — clap rejects `--type`
   with exit 2). Each invocation writes a clip-HTML at
   `<workdir>/refs/character/<slug>.clip.html`. Multiple
   `--character-type` values for the same name coexist; the planner
   picks the right one per shot.

The storyboard planner **auto-loads** `refs/character/` and routes any
Dialogue shot whose CHARACTER cue matches a loaded ref through
`Generation::RefConditioned { backend: "fal-veo3-ref", ... }`. ECU
hand-cutaway Action paragraphs (heuristic: text contains hand / hold /
grip / fingers + ECU shot type) prefer a same-character `hands` ref
over the `full-body` ref. The verifier WARNs on face-leak risk when
only `full-body` exists for an ECU hand shot.

Three `character_type` values:

| type            | use for                                   |
|-----------------|-------------------------------------------|
| `full-body`     | the canonical actor reference (face)      |
| `hands`         | ECU cutaways of the same character's hands|
| `product-hands` | hands gripping a specific product / pack  |

Reference precedence in ECU hand shots: `product-hands` > `hands` >
`full-body` (with WARN). Pass `--no-characters` to `storyboard plan`
to opt out of auto-loading for this run.

### Veo prompt structure — the 5-slot prose recipe

Veo wants descriptive narrative prose, not XML, not tagged sections, not
bullet lists (see <https://ai.google.dev/gemini-api/docs/video> on
prompting). What works well — reverse-engineered from the 010 eval
agent's prompts, which produced consistent-looking output despite the
ref-conditioning being broken — is to author each Veo prompt as a
single prose paragraph that touches five slots in this order:

1. **Subject identity** — who or what is on screen. Pull the character
   bible verbatim ("a 28-year-old woman with light olive skin and
   freckles, glossy collarbone-length brunette hair"). This is the slot
   the ref image conditions; describe it in writing too so the model
   has a textual anchor when the ref leaks.
2. **Wardrobe** — what the subject is wearing, in one beat
   ("cream ribbed cotton tank top"). Drop wardrobe entirely on ECU
   hand-only shots.
3. **Environment** — where they are and what's around them, in one or
   two beats ("at her bright bathroom vanity with soft daylight from
   a frosted window camera-left"). On hand-cutaway shots, this
   collapses to a surface and a backdrop ("cream marble bathroom
   counter softly out of focus").
4. **Light direction** — explicit cardinal-direction lighting cue
   ("soft window daylight from camera-left, slightly overexposed in
   highlights"). Veo will otherwise pick its own and your cuts won't
   match.
5. **Camera grammar** — framing, lens, motion, format, color
   ("Medium close-up, chest-up framing, eye contact with lens,
   handheld iPhone 16 Pro Max at chest height, Apple HDR camera-native
   color, 9:16 portrait, faint rolling-shutter wobble").

Keep slots 4 and 5 *identical strings* across every cut in a UGC spot —
that's how you get continuity. The variable beats live in slots 1–3.
Dialogue goes after the camera-grammar slot, framed as direct speech
("…says brightly in a natural American accent: '<line>'").

## Step 3 — run the agent-side pipeline

All free, deterministic, and reversible:

```bash
wavelet screenplay parse script.fountain --pretty -o screenplay.json
wavelet velocity propose script.fountain --pretty -o velocity.json
wavelet storyboard plan script.fountain --velocity velocity.json --pretty -o storyboard.json
wavelet storyboard verify storyboard.json
wavelet continuity check storyboard.json
wavelet transitions classify script.fountain --velocity velocity.json --pretty -o transitions.json
```

Read each output. `velocity.json`'s `mean_bpm` tells you the music's
target tempo. `storyboard.json`'s `shots[].subject` tells you what each
shot is about. The continuity report flags 180° / motion / scale-jump
issues — if there are errors, reorder the screenplay or add a transition.

### Transitions discipline — hard cut by default

Default to hard cut. Every cut is a hard cut unless the screenplay's
Fountain `> TRANSITION:` directive explicitly names one (e.g. `> WHIP
PAN RIGHT:`, `> CROSS DISSOLVE:`, `> MATCH CUT:`). When you do specify
a transition, it must be motivated by content — a whip-pan triggered
by an in-scene horizontal camera move, a cross-dissolve only for a
deliberate time-passing beat, a match cut on shared shape/motion
across the boundary.

The `transitions classify` stage WILL produce an empty or near-empty
`transitions.json` on a hard-cut spot. That is the desired state. If
the storyboard plan emits transitions without content motivation,
delete them from `transitions.json` before running the asset stage —
and from `commercial.html` before render. In the manifest,
hard cut means omitting `data-transition-in` entirely (the default is
`cut`), not setting `data-transition-in="crossfade"` with a short
duration.

Anti-pattern flagged on the 005 v4 run: the agent added transitions
between every scene boundary by default. The result reads as corporate-
AI cadence — every cut softened, no editorial decisions visible. Hard
cuts read as decisive editorial intent. It is the difference between a
spot that feels alive and one that feels like a screensaver.

## Step 3.25 — fill structured shot attributes (L-Storyboard)

`Shot` carries an optional `attributes` block — seven typed slots that
replace freeform prose in the eventual model prompt:

| Slot     | What it captures                                   |
|----------|----------------------------------------------------|
| subject  | what the shot is OF                                |
| action   | what's happening                                   |
| scene    | where it is (location + time of day + environment) |
| camera   | shot type + focal length + angle                   |
| lens     | optical character — DoF, anamorphic, fringe        |
| lighting | direction + quality of light                       |
| style    | aesthetic register, film stock, color grade        |

```json
"attributes": {
  "subject": "a 1968 Porsche 911 GT3 in racing yellow",
  "action": "idles, engine off, parked at pit lane",
  "scene": "on wet asphalt as the sun crests the ridge",
  "camera": "WS 50mm, low angle, 3/4 front",
  "lens": "anamorphic, shallow DoF, slight chromatic fringe",
  "lighting": "backlit by rising sun, mist-diffused",
  "style": "cinematic, A24-flavored, restrained color"
}
```

All seven required. If you don't know one, write the literal
`"unspecified"`. Reference fixture: `packages/wavelet/tests/fixtures/l-storyboard-example.json`.

## Step 3.26 — let an LLM fill the slots

```bash
wavelet director synthesize brief.md storyboard.json -o storyboard.dir.json --pretty
```

Default Gemini 2.5 Pro via fal-ai/any-llm (~$0.02–$0.05/spot). Pass
`--model claude` for Opus 4.7 fallback. Read the output and patch the
two or three slots that drift.

## Step 3.5 — generate the voiceover (optional)

```bash
wavelet dialogue tts "<your VO copy>" \
  --backend fal-kokoro \
  --voice af_nicole \
  --max-cost 0.05 \
  --out vo.wav \
  --pretty
```

VO copy: fits the total duration (~2.5 words/sec is a comfortable read
pace), lands the brand or model name clearly with a 1-second pause for
emphasis, ends on a tagline or CTA.

### Word-level captions (CapCut / Hormozi / minimal)

```bash
wavelet dialogue captions \
  --audio vo.wav --text "Fast cheap reliable big wins" \
  --backend fal-whisper-words --style hormozi \
  -o captions.json --pretty

wavelet captions overlay --in captions.json --style hormozi \
  --width 1080 --height 1920 -o caption.html
```

The emitted `caption.html` is a normal scene HTML file — drop it into
your scene list as a sibling. CSS is `@keyframes`-only (no JS) so it
renders correctly through Blitz.

## Step 4 — generate the music

```bash
wavelet music gen \
  --velocity velocity.json \
  --style "<2-3 line style description>" \
  --duration <total_secs> \
  --backend google-lyria \
  --max-cost 0.40 \
  --out music.mp3 \
  --pretty
```

Default `--backend google-lyria` (Lyria 3 Pro, ~$0.001/sec). For short
clips (<10s) the policy auto-falls-back to `google-lyria-3-clip`
(~$0.0004/sec). Both are Google-direct — no broker, single
`GOOGLE_API_KEY`.

**Budget floor: `--max-cost 0.40`** for a 30s spot at Lyria 3 Pro
($0.001/sec × 30s = $0.03, but the cost gate compares against
generation duration which can be ~3-4× the output for long clips —
0.40 is the empirical floor that doesn't refuse). Setting `0.10`
yields `exit 3: estimated cost $X exceeds budget` on the first try
every time; the agent burns ~2 retries before figuring it out.

Validate:

```bash
wavelet velocity validate velocity.json --against music/track.wav --tolerance 20 --pretty
```

The validator now also writes a sibling `music/track.cuts.edl` when onsets are
detected. Use those onsets as snap targets for shot boundaries.

## Step 5 — generate the shots

```bash
# per-shot txt2vid — default backend is fal-veo3-fast ($1.00 / 4 s)
wavelet shot txt2vid "<rich scene + motion prompt>" \
  --duration 4 --max-cost 1.20 \
  --out shots/shot-N.mp4 --pretty
```

**Default backend: `fal-veo3-fast`** ($0.25/s × 4s = $1.00/clip).
Allocate `--max-cost ≥ 1.20` on every shot or the cost gate refuses
with `estimated cost $1.00 exceeds budget $0.X`. Fal Veo durations
quantize to {4s, 8s} — values ≤ 5s round to 4s.

Alternates by `--backend`:
- `fal-veo3` — Standard tier on Fal, $0.50/s = $2.00/4s. Slightly
  better fidelity; use sparingly for hero shots.
- `fal-veo3-ref` / `fal-veo3.1-ref` — Veo 3.1 reference-to-video,
  ~$2.00 / 8 s (smoke-verified 2026-05-23). Conditions on up to 3
  character/scene refs for identity consistency (Google's documented
  cap; 4+ rejects). **Required when the storyboard reports a shot as
  `Generation::RefConditioned`** — pass each ref the storyboard
  supplied with `--reference <PATH_OR_URL>` (repeatable). Local paths
  are uploaded to fal-storage; HTTPS URLs go through directly.
  Without `--reference`, `fal-veo3-ref` rejects with
  `ref-to-video requires --reference`.
- `fal-veo3-ref-fast` / `fal-veo3.1-ref-fast` — same model family,
  fast tier. **Duration is locked to 8s** — Fal's schema literal-
  checks `"8s"` and HTTP-422s any other value. Plan storyboard math
  accordingly (a 16s spot = 2 ref-shots, a 24s spot = 3 ref-shots).
  If you need a 4s clip, use plain `fal-veo3-fast` with linguistic
  identity-lock; the trade-off is no visual reference conditioning.
- `veo` / `veo-fast` / `veo-lite` — Google direct. Currently quota-
  exhausted; will fail HTTP 429 RESOURCE_EXHAUSTED. Don't use until
  Google quota resets.

For a `RefConditioned` shot the dispatch looks like:

```bash
wavelet shot txt2vid "DANA at her vanity, soft window light, …" \
  --backend fal-veo3-ref \
  --reference ./refs/character/dana-full-body.jpg \
  --duration 4 --max-cost 1.20 \
  --out shots/shot-2.mp4 --pretty
```

The storyboard plan output enumerates the references per shot; the
agent's job is to forward them through to the shot command unchanged.

Prompt construction (in order, comma-separated): subject, action,
setting, composition, atmosphere, tech. The standard negative prompt
(`"no text overlay, no watermark, no distortion, no extra limbs, low
quality, blurry"`) is appended automatically.

### Variant generation — roll N, pick the winner

`wavelet shot txt2vid` accepts `--variants N` (1-8, default 1).

```bash
wavelet shot txt2vid "<hero scene + motion prompt>" \
  --variants 3 --select max-vlm \
  --max-cost 0.50 --max-variants-cost 1.50 --pretty
```

`--select` policies: `max-vlm` (default), `pairwise-tournament` (VISTA
bracket for identity-critical shots), `first`, `user`, `cheapest`.

Use `pairwise-tournament` for hero shots and identity-critical SKUs;
`max-vlm` for everything else. Skip variants entirely for filler shots.

## Step 6 — write the scene HTML overlays (FREEFORM)

**This is the section that decides whether your spot looks AI-default or
art-directed.** Read it carefully.

One `scenes/<id>.html` per scene composites *over* the generated video.
Blitz's CSS engine covers the bulk of the modern web platform: standard
CSS animations (`@keyframes`, `transition`, `cubic-bezier()`, `steps()`),
the full transform stack, clip-path, mix-blend-mode, all 16 blend modes,
gradients, web fonts, flexbox, grid, the works.

Your training data is dense in standard HTML/CSS. Use it. Anything you'd
write on a hand-crafted brand site renders here.

### Two structural rules

1. **`html` and `body` must have `background: transparent`** so the
   generated video shows through where your HTML doesn't paint.
2. **The per-scene background video is wired by an inline `<video>`
   element INSIDE each scene HTML file** — NOT via any `data-video-bg`
   attribute on `<section>` in `commercial.html`. (The renderer parses
   `<video>` in `compose/resolve.rs`; `data-video-bg` is unsupported
   and silently dropped, orphaning Veo clips at compose time. Earlier
   versions of this doc claimed `data-video-bg` worked — they were
   wrong.) Canonical scene pattern:

   ```html
   <body>
     <video src="../shots/shot-N.mp4" autoplay muted playsinline
            style="position:absolute;inset:0;width:100%;height:100%;
                   object-fit:cover;z-index:-1;"></video>
     <!-- your HTML overlays go here, on top of the video -->
   </body>
   ```

   The `z-index:-1` pushes the video behind the overlay layer. The
   `position:absolute;inset:0` covers the whole frame. `object-fit:
   cover` crops to fill (use `contain` if you need letterbox behavior).
   Top-level `<audio>` elements in `commercial.html` are bound to the
   comp's audio cue list — that's the canonical place for music + VO.

### The supported palette — every one of these works today

Pull from this whenever you're tempted to default to the bottom-left
lockup. One-line examples each; treat them as the toolkit.

**Layout + position**

```css
.frame { position: absolute; inset: 0; display: grid; grid-template-rows: 1fr auto; }
.lower-third { display: flex; gap: 1.2rem; align-items: flex-end; padding: 4rem; }
```

`position: absolute / fixed / relative`, flexbox, grid, `inset`, `gap`,
`aspect-ratio`, `z-index`. `position: sticky` does not work (no scroll
in video).

**Typography**

```css
@import url("https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400;900&display=swap");
@font-face { font-family: "Custom"; src: url("./fonts/custom.woff2") format("woff2"); }
.title { font: 900 240px/0.88 "Bodoni Moda", serif; letter-spacing: -0.04em; }
.subtitle { font: 200 18px "Inter", sans-serif; letter-spacing: 0.4em; text-transform: uppercase; }
```

System fonts work. WOFF / WOFF2 via `@font-face`. Google Fonts via
`@import`. Variable font axes work where Stylo understands the
named-instance form. `line-height`, `letter-spacing`, `word-spacing`,
`text-transform`, `text-align`, `font-feature-settings`, `font-variant`
all work.

**Color + gradients**

```css
.scrim { background: linear-gradient(180deg, transparent 0%, #000a 60%, #000 100%); }
.aurora { background: conic-gradient(from 90deg at 30% 70%, #f06, #f60, #06f, #f06); }
.spot   { background: radial-gradient(ellipse at 30% 30%, #fffa 0%, transparent 60%); }
```

Linear, radial, and conic gradients. Hex / rgb / rgba / hsl /
`color-mix()`. `currentColor` and CSS variables.

**Transforms**

```css
.tilt { transform: rotate(-3deg) scale(1.08) translateX(40px); transform-origin: top left; }
.skew { transform: skewX(-8deg); }
```

`translate`, `scale`, `rotate`, `skew`, `matrix()`, `transform-origin`,
3D transforms (`rotateX/Y/Z`, `perspective`).

**Borders, shadows, radius**

```css
.card { border: 2px solid #fff; border-radius: 24px; box-shadow: 0 24px 80px #000c, inset 0 0 0 1px #fff2; }
```

Multi-stop borders, `border-radius` (each corner independently),
`box-shadow` (multiple, including `inset`).

**clip-path** — *use this*

```css
.window { clip-path: circle(40% at 50% 50%); }
.notch  { clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%); }
.tag    { clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 50%, calc(100% - 24px) 100%, 0 100%); }
```

`circle()`, `polygon()`, and the box-keyword forms (`margin-box`,
`border-box`, `padding-box`, `content-box`) render today.
`inset()`, `ellipse()`, `path()`, and `url(#mask)` are silently dropped
— pick a polygon or circle approximation if you need a rect-with-radius
window.

**mix-blend-mode** — *use this*

```css
.title-diff   { color: #fff; mix-blend-mode: difference; }
.title-screen { mix-blend-mode: screen; }
.title-mult   { mix-blend-mode: multiply; }
```

All 16 CSS blend modes render through Vello's `peniko::Mix` —
`multiply, screen, overlay, darken, lighten, color-dodge, color-burn,
hard-light, soft-light, difference, exclusion, hue, saturation, color,
luminosity, normal`. `difference` over a generated shot is the canonical
"type carves through video" idiom and you should use it at least once
per spot.

**filter** — *use this*

```css
.soft     { filter: blur(8px); }
.poster   { filter: contrast(1.6) saturate(1.2); }
.mono     { filter: grayscale(1); }
.shifted  { filter: hue-rotate(180deg); }
.lifted   { filter: drop-shadow(0 12px 24px rgba(0,0,0,0.6)); }
.chained  { filter: blur(2px) saturate(1.3) brightness(1.1); }
```

`blur(Npx)`, `saturate(N)`, `brightness(N)`, `contrast(N)`,
`grayscale(N)`, `hue-rotate(Ndeg)`, `invert(N)`, `sepia(N)`, `opacity(N)`,
and `drop-shadow(X Y B color)` all render. Chains apply left-to-right
per CSS spec. Implemented as a render-to-image fallback in
`vendor/blitz-paint/src/render/filter.rs` — the element is painted into
a sidecar Vello scene, the resulting RGBA buffer is filtered via
`image::imageops::blur` for spatial blur + standard `feColorMatrix`
matrices for color filters, then composited back into the parent scene
as an image brush. The fallback expands the painted region by 3·sigma
for blur and by the offset + 3·sigma for drop-shadow, so soft halos
don't get clipped.

`backdrop-filter` ships via the same render-to-image fallback: when an
element has a non-pass-through `backdrop-filter` we re-rasterize the
document into a sidecar pixmap, apply the filter list to the pixmap,
and composite the result back clipped to the element's border box
(border-radius honored). Supported functions: `blur`, `saturate`,
`brightness`, `contrast`, `grayscale`, `invert`, `sepia`, `opacity`,
`hue-rotate`. `drop-shadow` is a no-op on `backdrop-filter`.

**Standard CSS animations** — *use this*

```css
@keyframes title-in {
  0%   { transform: translateY(40px); opacity: 0; }
  60%  { transform: translateY(-4px); opacity: 1; }
  100% { transform: translateY(0);    opacity: 1; }
}
.title { animation: title-in 0.9s var(--ease-out-back) both; }

.subtitle { transition: opacity 0.4s ease-out 0.3s; opacity: 0; }
.scene.live .subtitle { opacity: 1; }
```

Stylo drives `@keyframes` and `transition` advance per-frame from the
scene clock — `render_offline.rs` resolves the document at every frame's
local time, so animations actually play in offline render. `linear`,
`ease`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(…)`,
`steps(N [, jump-…])` all render. `animation-fill-mode`,
`animation-delay`, `animation-iteration-count`, `animation-direction`
work. Stagger by `:nth-child` + `animation-delay` math.

Springs / bounces / elastic / wiggle aren't representable as
cubic-bezier. For those, lay out the animation as a multi-stop
`@keyframes` timeline by hand — Stylo interpolates per-stop.

**Extended easing — paste from `eases.css`**

A sibling file ships the standard easings.net curves as CSS custom
properties — `var(--ease-out-back)`, `var(--ease-out-expo)`,
`var(--ease-out-quint)`, etc., 24 named eases total. Copy the `:root`
block from `packages/workbooks/skills/wavelet-director/eases.css` into each
scene's `<style>` (or `@import` it). Two scenes in every spot should
reach into the extended table — `ease-out` is fine but identical use of
plain `ease` across every cut is the AI-default tell.

```css
:root {
  --ease-out-back:  cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out-quint: cubic-bezier(0.22, 1,    0.36, 1);
  --ease-out-expo:  cubic-bezier(0.16, 1,    0.3,  1);
  /* …see eases.css for the full set */
}

.title  { animation: enter 0.9s var(--ease-out-back) both; }
.kicker { animation: enter 1.4s var(--ease-out-quint) 0.2s both; }
```

**`<img>` element**

```html
<img src="./logo.svg" style="width: 120px; opacity: 0.9;">
<img src="./moodboard-1.png" style="position: absolute; inset: 0; object-fit: cover;">
```

Raster images (PNG / JPG / WebP) and SVG paint natively. Decoded via the
image crate's codec features in Blitz. `object-fit`, `object-position`
work.

### Variation across cuts — a hard rule

Within a single spot, **no two adjacent scenes may share the same
typographic treatment**. Same typeface across the spot is fine — that's
the through-line. Same size *and* position *and* motion is the
"AI-default" tell that flattens the work.

The good failure mode: "scene 1 uses Bodoni 240px center, scene 2 uses
Inter 22px upper-right, scene 3 is type-free, scene 4 uses JetBrains
Mono 18px corner tags." The bad failure mode: "scene 1 is Inter 88px
bottom-left, scene 2 is Inter 88px bottom-left, scene 3 is Inter 88px
bottom-left, scene 4 is Inter 88px bottom-left."

### Self-check before declaring a scene done

Ask yourself:

1. **Did I reuse the previous scene's lockup?** Same typeface + same
   size + same position + same motion. If yes — redo this one.
2. **Did I reach for `clip-path` or `mix-blend-mode` anywhere in the
   spot?** Neither one is mandatory in every scene, but a four-scene
   spot that doesn't touch either is using maybe 30% of the palette.
3. **Did I use anything from the extended ease table?** At least two
   scenes should be on `var(--ease-*)` curves, not plain `ease`.
4. **Did I let any scene have zero type?** Editorial silence is a real
   move. Captioning every cut isn't a requirement.
5. **Are my animations distinct per scene?** Four scenes all running the
   same `@keyframes slide-in` is the AI-default in motion form.

### Anti-pattern gallery — do NOT ship these

```css
/* ANTI-PATTERN 1: the AI-default lockup. Four scenes of this is failure. */
.title {
  position: absolute; left: 80px; bottom: 80px;
  font: 900 88px Inter, sans-serif;
  color: white;
  animation: fade-in 0.6s ease both;
}
```

```css
/* ANTI-PATTERN 2: same @keyframes recycled across every scene */
@keyframes enter { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
.scene-1-title { animation: enter 0.6s ease both; }
.scene-2-title { animation: enter 0.6s ease both; }
.scene-3-title { animation: enter 0.6s ease both; }
.scene-4-title { animation: enter 0.6s ease both; }
```

```css
/* ANTI-PATTERN 3: everything centered, no negative-space awareness */
.scene { display: grid; place-items: center; }
.title { text-align: center; font-size: 120px; }
/* Repeated unmodified across all four scenes. */
```

```css
/* ANTI-PATTERN 4: plain `ease` everywhere, no extended curves used */
.a { animation: in 0.5s ease both; }
.b { animation: in 0.5s ease-in-out both; }
.c { animation: in 0.5s ease both; }
.d { animation: in 0.5s ease both; }
```

### Edge insets, contrast, reading rate — verify with the tools

- **Title-safe** is the center 80% (10% inset off each edge). Type
  across title-safe is a deliberate choice (brutalist, display-driven).
  Type across action-safe (center 90%, 5% inset) is a mistake on most
  platforms. `wavelet::aspect::safe_areas(w, h)` returns the right
  rectangles per aspect.
- **Read the shot first.** `wavelet image negative-space <png>` returns
  the eye-friendly grid cells with suggested text color + scrim opacity.
  Position type in the top-ranked zone unless you have a reason to
  fight the shot.
- **Contrast.** `wavelet image contrast <png> --region X,Y,W,H
  --text-color #...` reports WCAG ratio + suggests a scrim if below
  threshold. WCAG AA is 4.5:1 for normal text, 3:1 for 18pt+ or 14pt
  bold. Below AA is a deliberate choice (luxury whisper, brutalist
  clash), not an accident.
- **Reading rate** is ~2.5 chars/sec. Kinetic word-by-word reveals live
  in the 0.25–0.4s range; faster than 0.15s reads as a flicker.
- **Existing text in the shot.** `wavelet image ocr <png>` (stubbed
  pending Fal got-ocr) detects baked-in text so you don't stack overlays
  on plate numbers or storefront signage.

### Halo-contrast lint and the post-render check

The `text-readability` rule's contrast pass measures **glyph ink
pixels vs a dilation halo just outside them** — not the bbox region.
This catches white-text-on-bright-image cases that the old min/max
region scan missed. The check runs at two stages:

- **Lint-time** (`wavelet lint commercial.html`) — renders the scene
  HTML and runs halo contrast on the result. Catches CSS-only color
  mistakes (white on `background: #fff`).
- **Post-render** (`wavelet lint commercial.html --mp4 commercial.mp4`)
  — samples 4 frames from the final MP4 via ffmpeg and runs the same
  measurement against the actual composited pixels (HTML overlay +
  Veo video underneath). This is the only stage that sees the same
  pixels the viewer will. Run it before declaring `compose` complete.

### Text color rules — bias toward maximum contrast

Default to one of these two combinations unless the design genuinely
requires otherwise:

- **White text on a saturated brand color or dark scrim** — works
  against almost any image.
- **Black text on a white panel** — for product / quote / data
  callouts where the body type carries weight.

Avoid **color-on-color** unless the two are far apart in luminance
(not just hue). Two saturated colors with similar L* (e.g. mid-tone red
text on mid-tone green) read as muddy and fail WCAG even when they
look distinct on a swatch.

### When contrast can't be achieved against the video underlay

The halo-contrast lint will tell you. In order of preference:

1. **Wrap the text in a panel.** A solid (or semi-opaque)
   `background-color` div around the text element gives the halo a
   stable background to measure against. The panel's color becomes the
   contrast denominator, not the unpredictable Veo frame.
   ```html
   <div class="cta-panel"><span class="cta">Shop now</span></div>
   <style>
     .cta-panel { background: #fff; padding: 16px 24px; border-radius: 8px; }
     .cta { color: #111; font-weight: 800; }
   </style>
   ```
2. **Add a scrim under the text.** A semi-transparent dark rect under
   white type (`rgba(0,0,0,0.55)` is a common floor). Less visible than
   a full panel but enough to push the ratio over AA.
3. **Re-pick the shot composition.** If the agent has an alternate
   variant (or budget to roll another), bias toward shots with
   predictable dark or light negative space where the text will sit.
4. **Subtle drop shadow as a last resort.** A tight, low-opacity drop
   shadow (`text-shadow: 0 1px 2px rgba(0,0,0,0.5)`) can lift contrast
   just enough to pass the lint without breaking the look. Use this
   only when (1) and (2) clash with the design language — it's a
   patch, not a design choice.

**Never** ship text that fails the post-render halo contrast lint. If
the lint flags it, the viewer will struggle to read it.

## Step 6.5 — ten worked scene examples (study these)

Each example is a complete `<style>` + `<body>` block. They span the
palette — copy patterns from these directly into your scenes. They
deliberately don't share a lockup.

### Example 1 — Brutalist: Helvetica Black, all-caps, covers the frame

```html
<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; background: transparent; width: 100%; height: 100%; overflow: hidden; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #fff; }
  .smash {
    position: absolute; inset: 0;
    display: grid; grid-template-rows: 1fr auto;
    padding: 24px 32px;
  }
  .word {
    font-weight: 900;
    font-size: 26vw;
    line-height: 0.78;
    letter-spacing: -0.05em;
    text-transform: uppercase;
    margin: 0;
  }
  .word.two { text-align: right; transform: translateY(-0.05em); }
  .meta {
    font-size: 18px; letter-spacing: 0.3em; text-transform: uppercase;
    display: flex; justify-content: space-between;
  }
  @keyframes punch-in {
    0%   { transform: scale(1.04); opacity: 0; }
    60%  { transform: scale(1);    opacity: 1; }
    100% { transform: scale(1);    opacity: 1; }
  }
  .word { animation: punch-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
  .word.two { animation-delay: 0.18s; }
</style></head>
<body>
  <div class="smash">
    <div>
      <h1 class="word">NOW</h1>
      <h1 class="word two">EVERYTHING</h1>
    </div>
    <div class="meta"><span>04 / SS26</span><span>FIELD NOTES</span></div>
  </div>
</body></html>
```

Design intent: type IS the image. Reads at any size, leans anti-pretty,
defies the safe-area convention deliberately.

### Example 2 — Editorial: Didone serif, asymmetric two-line moment

```html
<!doctype html>
<html><head>
<style>
  @import url("https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,700;1,400&display=swap");
  html, body { margin: 0; padding: 0; background: transparent; height: 100%; }
  .frame { position: absolute; inset: 0; padding: 8vh 9vw; display: grid; grid-template-rows: 1fr auto 1fr; }
  .moment {
    font-family: "Bodoni Moda", "Didot", serif;
    color: #f5efe6;
    font-size: 7vw;
    line-height: 1.02;
    font-weight: 400;
  }
  .moment em { font-style: italic; font-weight: 400; }
  .line-1 { grid-row: 2; max-width: 60%; }
  .kicker {
    align-self: end; justify-self: end;
    grid-row: 3;
    font: 400 14px/1.4 "Bodoni Moda", serif;
    letter-spacing: 0.34em; text-transform: uppercase;
    color: #f5efe6c0;
    max-width: 22ch; text-align: right;
  }
  @keyframes drift-up {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .moment { animation: drift-up 1.4s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .kicker { animation: drift-up 1.8s cubic-bezier(0.22, 1, 0.36, 1) 0.4s both; }
</style></head>
<body>
  <div class="frame">
    <div class="moment line-1">A place, <em>not</em><br>a product.</div>
    <div class="kicker">Marrakech Intense — Eau de Toilette</div>
  </div>
</body></html>
```

Design intent: print-magazine pacing. Negative space carries the weight;
the type is small relative to the canvas and offset off-center.

### Example 3 — Kinetic: single-word per-beat reveal

```html
<!doctype html>
<html><head><style>
  :root {
    --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
    --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  }
  html, body { margin: 0; background: transparent; height: 100%; font-family: "Inter", sans-serif; }
  .stage {
    position: absolute; inset: 0;
    display: grid; place-items: center;
  }
  .beat {
    position: absolute;
    font-weight: 900;
    font-size: 18vw;
    line-height: 1;
    color: #fff;
    opacity: 0;
    letter-spacing: -0.02em;
  }
  @keyframes pop {
    0%   { transform: scale(0.82); opacity: 0; }
    18%  { transform: scale(1.02); opacity: 1; }
    32%  { transform: scale(1);    opacity: 1; }
    78%  { transform: scale(1);    opacity: 1; }
    100% { transform: scale(0.96); opacity: 0; }
  }
  .beat:nth-child(1) { animation: pop 0.9s var(--ease-out-back) 0.0s both; }
  .beat:nth-child(2) { animation: pop 0.9s var(--ease-out-back) 0.9s both; }
  .beat:nth-child(3) { animation: pop 0.9s var(--ease-out-back) 1.8s both; }
  .beat:nth-child(4) { animation: pop 1.2s var(--ease-out-expo) 2.7s both; color: #ffd400; }
</style></head>
<body>
  <div class="stage">
    <div class="beat">RUN.</div>
    <div class="beat">FALL.</div>
    <div class="beat">RUN.</div>
    <div class="beat">AGAIN.</div>
  </div>
</body></html>
```

Design intent: one word at a time. Last word breaks the color rule for
emphasis. The pop / dwell / fade timing is the whole effect.

### Example 4 — Luxury whisper: thin weight, near-invisible

```html
<!doctype html>
<html><head><style>
  @import url("https://fonts.googleapis.com/css2?family=Inter:wght@200&display=swap");
  html, body { margin: 0; background: transparent; height: 100%; }
  .center {
    position: absolute; inset: 0;
    display: grid; place-items: center;
  }
  .whisper {
    font-family: "Inter", sans-serif;
    font-weight: 200;
    font-size: 22px;
    color: #ffffffb0;
    letter-spacing: 0.55em;
    text-transform: uppercase;
    padding-left: 0.55em;
    transition: opacity 1.6s ease-out;
  }
  @keyframes whisper-in {
    from { opacity: 0; letter-spacing: 0.2em; }
    to   { opacity: 1; letter-spacing: 0.55em; }
  }
  .whisper { animation: whisper-in 2.2s cubic-bezier(0.22, 1, 0.36, 1) both; }
</style></head>
<body>
  <div class="center"><div class="whisper">Eau de Marrakech</div></div>
</body></html>
```

Design intent: the type apologizes for being there. Wide tracking,
near-transparent fill, only barely legible. Used for luxury houses
where the product image carries the spot.

### Example 5 — Display-driven: massive number, video bleeds through negative space

```html
<!doctype html>
<html><head><style>
  html, body { margin: 0; background: transparent; height: 100%; font-family: "Helvetica Neue", sans-serif; }
  .spec {
    position: absolute; inset: 0;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    grid-template-rows: 1fr auto 1fr;
  }
  .number {
    grid-column: 2; grid-row: 2;
    font-weight: 900;
    font-size: 52vw;
    line-height: 0.8;
    color: #fff;
    mix-blend-mode: difference;
    margin: 0;
    letter-spacing: -0.05em;
  }
  .units {
    position: absolute;
    right: 4vw; bottom: 6vh;
    color: #fff;
    font-size: 14px;
    letter-spacing: 0.35em;
    text-transform: uppercase;
    text-align: right;
    line-height: 1.6;
  }
  @keyframes ramp {
    from { transform: translateY(8vh); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }
  .number { animation: ramp 1.1s cubic-bezier(0.22, 1, 0.36, 1) both; }
</style></head>
<body>
  <div class="spec">
    <h1 class="number">911</h1>
  </div>
  <div class="units">HP : 502<br>0 → 60 : 3.2s<br>SS / 26</div>
</body></html>
```

Design intent: one number fills the frame, video shows through where
the number isn't. `mix-blend-mode: difference` inverts the underlying
pixels through the type so the number is legible against any shot.

### Example 6 — Typographic mask: clip-path carves a word-shape into the video

```html
<!doctype html>
<html><head><style>
  html, body { margin: 0; background: transparent; height: 100%; }
  .stage { position: absolute; inset: 0; display: grid; place-items: center; }
  /* Hex polygon that reads as a viewing port through the scene. */
  .port {
    width: 70vw; aspect-ratio: 16 / 7;
    background: #000;
    clip-path: polygon(8% 0, 92% 0, 100% 50%, 92% 100%, 8% 100%, 0% 50%);
    mix-blend-mode: lighten;
  }
  .legend {
    position: absolute; left: 8vw; bottom: 8vh;
    font: 800 22px "Helvetica Neue", sans-serif;
    color: #fff;
    letter-spacing: 0.18em; text-transform: uppercase;
  }
  @keyframes iris {
    from { clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%, 50% 50%, 50% 50%); }
    to   { clip-path: polygon(8% 0,    92% 0,    100% 50%, 92% 100%, 8% 100%, 0% 50%); }
  }
  .port { animation: iris 0.9s cubic-bezier(0.65, 0, 0.35, 1) both; }
</style></head>
<body>
  <div class="stage"><div class="port"></div></div>
  <div class="legend">Sector — 04 / observed</div>
</body></html>
```

Design intent: a polygon clip-path masks a black plate against the
moving footage; `mix-blend-mode: lighten` keeps the brightest pixels
of the video visible through the mask. The clip-path animates from a
collapsed point to its full hexagonal aperture — an iris reveal.

### Example 7 — Mono / tech: small fixed-width corner tags

```html
<!doctype html>
<html><head>
<style>
  @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&display=swap");
  html, body { margin: 0; background: transparent; height: 100%; }
  .hud { position: absolute; inset: 0; padding: 20px 28px; color: #fff; font-family: "JetBrains Mono", monospace; font-size: 14px; }
  .tl, .tr, .bl, .br { position: absolute; opacity: 0.92; }
  .tl { top: 20px; left: 28px; }
  .tr { top: 20px; right: 28px; text-align: right; }
  .bl { bottom: 20px; left: 28px; }
  .br { bottom: 20px; right: 28px; text-align: right; }
  .row { display: flex; gap: 1.2em; }
  .key { color: #fff8; }
  @keyframes flicker {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.6; }
  }
  .live { animation: flicker 0.8s steps(2, jump-end) infinite; }
</style></head>
<body>
  <div class="hud">
    <div class="tl"><div class="row"><span class="key">LOC</span> 34.0522°N · 118.2437°W</div></div>
    <div class="tr"><div>T+ 00:00:04.20</div></div>
    <div class="bl"><div class="row"><span class="key">CH</span> 02 · <span class="key">F-STOP</span> 2.8</div></div>
    <div class="br"><span class="live">● REC</span></div>
  </div>
</body></html>
```

Design intent: zero hero typography. The "design" is fixed-width metadata
in four corners with a flickering REC indicator. Reads as observational,
not commercial.

### Example 8 — Editorial silence: zero text

```html
<!doctype html>
<html><head><style>
  html, body { margin: 0; background: transparent; height: 100%; }
  .vignette {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at center, transparent 40%, #00000050 80%, #000000a0 100%);
    transition: opacity 1s ease-out;
    animation: vignette-in 2.4s ease-out both;
  }
  @keyframes vignette-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
</style></head>
<body>
  <div class="vignette"></div>
</body></html>
```

Design intent: editorial pacing demands a beat with no caption. A subtle
radial vignette frames the shot and that is the entire overlay. Don't
caption every scene.

### Example 9 — Vertical pour: lower-third slide-up with extended ease

```html
<!doctype html>
<html><head><style>
  :root { --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1); }
  html, body { margin: 0; background: transparent; height: 100%; font-family: "Inter", sans-serif; color: #fff; }
  .pour {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 5vh 6vw;
    background: linear-gradient(180deg, transparent 0%, #000a 70%, #000c 100%);
    display: grid; grid-template-columns: auto 1fr; gap: 2.4rem; align-items: end;
  }
  .lockup .name {
    font-weight: 700; font-size: 36px;
    letter-spacing: -0.01em;
    margin: 0 0 0.2em;
  }
  .lockup .strap {
    font-weight: 300; font-size: 15px;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: #ffffffb0;
  }
  .cta {
    align-self: end; justify-self: end;
    border: 1.5px solid #fff;
    padding: 0.7em 1.4em;
    font-size: 14px; letter-spacing: 0.22em; text-transform: uppercase;
    border-radius: 999px;
  }
  @keyframes rise {
    from { transform: translateY(8vh); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }
  .pour { animation: rise 1.2s var(--ease-out-quint) 0.2s both; }
</style></head>
<body>
  <div class="pour">
    <div class="lockup">
      <h2 class="name">Allbirds Tree Runner</h2>
      <div class="strap">Made from trees — Walk on it</div>
    </div>
    <div class="cta">Try them barefoot</div>
  </div>
</body></html>
```

Design intent: classic broadcast lower-third, but with the extended
`out-quint` curve so the rise feels weighted rather than rubbery. The
CTA pill on the right balances the type on the left.

### Example 10 — Multi-element kinetic stack with staggered eases

```html
<!doctype html>
<html><head><style>
  :root {
    --ease-out-back:   cubic-bezier(0.34, 1.56, 0.64, 1);
    --ease-out-quint:  cubic-bezier(0.22, 1,    0.36, 1);
    --ease-out-circ:   cubic-bezier(0,    0.55, 0.45, 1);
  }
  html, body { margin: 0; background: transparent; height: 100%; font-family: "Inter", sans-serif; color: #fff; }
  .stack {
    position: absolute; left: 6vw; top: 50%;
    transform: translateY(-50%);
    display: flex; flex-direction: column; gap: 0.6em;
    max-width: 56%;
  }
  .stack > * { opacity: 0; transform: translateX(-40px); }
  .stack .eyebrow { font-size: 14px; letter-spacing: 0.3em; text-transform: uppercase; color: #ffd400; font-weight: 600; }
  .stack .head    { font-size: 7vw; line-height: 1; font-weight: 900; letter-spacing: -0.03em; }
  .stack .sub     { font-size: 18px; max-width: 36ch; color: #ffffffd0; line-height: 1.4; }
  @keyframes slide-in {
    to { opacity: 1; transform: translateX(0); }
  }
  .stack > :nth-child(1) { animation: slide-in 0.6s var(--ease-out-back)  0.15s forwards; }
  .stack > :nth-child(2) { animation: slide-in 0.9s var(--ease-out-quint) 0.35s forwards; }
  .stack > :nth-child(3) { animation: slide-in 1.1s var(--ease-out-circ)  0.65s forwards; }
</style></head>
<body>
  <div class="stack">
    <div class="eyebrow">FIELD TEST · DAY 12</div>
    <h1 class="head">Built for the long walk home.</h1>
    <p class="sub">Eucalyptus-fiber upper. Sugarcane sole. Machine washable. The kind of comfort you forget about — until you take them off.</p>
  </div>
</body></html>
```

Design intent: three vertically-stacked elements, each animating in on
a different ease curve from the extended table. Staggered by
`animation-delay`. The contrast between the back / quint / circ feel is
the design — three siblings, three personalities.

### Example 11 — Difference-mode title over a generated shot

```html
<!doctype html>
<html><head><style>
  html, body { margin: 0; background: transparent; height: 100%; font-family: "Helvetica Neue", sans-serif; }
  .stage { position: absolute; inset: 0; display: grid; place-items: end center; padding: 6vh 0; }
  .knockout {
    font-weight: 900;
    font-size: 16vw;
    line-height: 0.92;
    color: #fff;
    mix-blend-mode: difference;
    letter-spacing: -0.035em;
    text-align: center;
    margin: 0;
  }
  @keyframes settle {
    0%   { letter-spacing: 0.2em;   opacity: 0; }
    100% { letter-spacing: -0.035em; opacity: 1; }
  }
  .knockout { animation: settle 1.3s cubic-bezier(0.16, 1, 0.3, 1) both; }
</style></head>
<body>
  <div class="stage">
    <h1 class="knockout">EVERYWHERE.<br>NOWHERE.</h1>
  </div>
</body></html>
```

Design intent: the canonical "white type that carves through video".
`mix-blend-mode: difference` makes the type readable over any underlying
footage by inverting whatever's behind it. The kerning animation from
wide to tight is the entry move.

## What does NOT work

The agent should never reach for these — they're silent no-ops at time
of writing. If you write them, expect nothing to render.

- **`background-clip: text` inside `<style>` rules** — wb-e8jh.7 (Stylo
  gates the `Text` variant behind a Gecko-only flag). Inline
  `style="background-clip:text; -webkit-background-clip:text;
  color:transparent"` DOES work — that's the only form that survives
  Stylo today. Prefer inline-styled text-clip; avoid the stylesheet
  form until the Stylo patch lands.
- *(text-shadow with `blur > 0` now ships via render-to-image — soft
  glows, drop shadows, and stacked hard+blur shadows all paint. Cost
  is roughly N rasterizations per N blurred shadows on the same block,
  so don't stack ten on a single title if 30fps matters.)*
- *(`backdrop-filter` now ships — wb-3v87. Same fallback as `filter`:
  re-rasterize the document into a pixmap, apply the filter list, and
  composite back clipped to the element's border box. The full filter
  function set is supported except `drop-shadow` which is a no-op on
  backdrop. Cost is one full document rasterization per
  backdrop-filter element, so don't stack many on a high-frame-rate
  scene.)*
- **`clip-path: url(#mask) / shape()`** — external SVG masks and the
  CSS `shape()` function don't ship. Use `path('M…')` instead — full
  SVG path-data is supported. The full clip-path family that DOES
  paint: `circle()`, `ellipse()`, `polygon()`, `inset()` (with
  `round` radii), `path('M…')`, `xywh()`, `rect()`, and box keywords.
- **`mask-image` / `mask`** — not wired through Stylo's style
  computation. Use `clip-path: polygon(…)` as the closest substitute.
- **JavaScript** — `<script>` tags are silently ignored. All animation
  goes through CSS. There is no canvas, no JS-driven render hook, no
  user event loop. Don't write JS.
- *(inline `<video>` and `<audio>` inside scene HTML are supported —
  see Step 6 for the canonical idiom. **`data-video-bg` on a
  `<section>` in `commercial.html` is NOT supported by the renderer;
  it is silently dropped at compose time and orphans the Veo clip.**
  Always embed the inline `<video>` inside the scene HTML body.)*
- **`position: sticky`, `:hover`, `:focus`, scroll-driven anything** —
  there is no scroll, no hover, no focus in offline video render.
  Selectors that depend on user interaction don't fire.
- **`<iframe>`** — not supported.

## Step 7 — assemble the multi-scene manifest

The canonical authoring path is a top-level `index.html` that lists the
scenes and their audio cues. The renderer parses it via
`packages/wavelet/src/compose/mod.rs` and resolves relative paths against
the manifest's parent directory.

```html
<!doctype html>
<html><head>
  <title>Tree Runner Spot</title>
  <meta name="resolution" content="1280x720">
  <meta name="fps" content="30">
  <meta name="duration" content="15s">
</head><body>
  <section data-scene-href="scenes/01-title.html"   data-duration="3s"></section>
  <section data-scene-href="scenes/02-product.html" data-duration="6s"
           data-transition-in="crossfade" data-transition-duration="0.5s"></section>
  <section data-scene-href="scenes/03-detail.html"  data-duration="3s"></section>
  <section data-scene-href="scenes/04-cta.html"     data-duration="3s"
           data-transition-in="crossfade" data-transition-duration="0.4s"></section>

  <audio src="music/track.wav" data-spans="all" data-volume="0.8" data-fade-in="0.4s" data-fade-out="1s"></audio>
  <audio src="vo/line.wav"     data-start="6s" data-duration="3s" data-fade-in="0.2s"></audio>
</body></html>
```

Required `<meta>`: `resolution` (`WxH`) and `fps`. `duration` is
optional — if omitted, the composition duration is the sum of scene
durations.

**`<section>` attributes:**

| Attribute                  | Required | What it means                              |
|----------------------------|----------|--------------------------------------------|
| `data-scene-href`          | yes      | Relative path to the scene HTML file       |
| `data-duration`            | yes      | `3s`, `1500ms`, or plain integer seconds   |
| `data-transition-in`       | no       | `cut` (default), `crossfade`, `fade`, `shader:<name>` |
| `data-transition-duration` | no       | Duration of the transition; default `0.5s` |

**`<audio>` attributes:**

| Attribute       | What it means                                                  |
|-----------------|----------------------------------------------------------------|
| `src`           | Asset path (relative). REQUIRED.                                |
| `data-spans`    | `all` — bind to the full composition duration                  |
| `data-start`    | Start offset, default `0s`                                     |
| `data-duration` | Explicit duration; default 0 (use until end)                   |
| `data-fade-in`  | Fade-in duration                                                |
| `data-fade-out` | Fade-out duration                                              |
| `data-volume`   | Float 0..1, default `1.0`                                      |

Per-scene background video is wired by an inline `<video src=
"../shots/shot-N.mp4" autoplay muted playsinline style="position:
absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;
">` element inside the scene HTML body — see Step 6's two structural
rules. `data-video-bg` on a `<section>` is silently ignored by the
renderer.

Render with:

```bash
wavelet render commercial.html -o commercial.mp4
```

HTML is the only accepted input. Any non-HTML input is rejected at
exit 3 with no fallback.

## Step 7.5 — composition input rule

**`wavelet render` accepts ONLY a `commercial.html` manifest.** Any
other input — `.json`, `.toml`, `.yaml`, anything — is rejected with
exit 3 and no fallback path. There is no escape hatch.

If a render call fails:
1. Read the error message — it points at the exact fix.
2. Fix the upstream stage (storyboard plan, captions, scene HTML).
3. Re-run `wavelet render commercial.html`.

If you ever feel tempted to write a JSON composition file, STOP.
That's the wrong escape hatch. Diagnose the upstream sticky step and
fix THAT instead. Every adversarial eval that ran into hand-authored
JSON ended in pipeline-gate failure — the JSON path bypasses every
lint rule, contrast measurement, and discipline check.

> Historical note: prior versions of wavelet accepted `comp.json` as a
> parallel render input with a 7-property motion enum. Both have been
> retired. Animation lives in standard CSS now (Stylo's `@keyframes` +
> `transition`); composition lives in `commercial.html`.

## Step 7.9 — pre-flight: wavelet lint

Before declaring the run complete and writing `notes.md`, the agent
MUST invoke lint with **`--mp4`** pointing at the rendered final cut:

```bash
wavelet lint commercial.html --platform <p> --mp4 commercial.mp4
```

The `--mp4` flag is **REQUIRED** — without it, the `wavelet_lint_passes`
pipeline gate refuses to mark the compose stage complete and emits
`missing_mp4_postrender_lint`. The flag enables the post-render
contrast pass, which samples the actual composited MP4 frames (HTML
overlay + Veo video underneath) and runs WCAG-AA contrast checks
against those pixels. It's the only stage that sees the same pixels
the viewer will. An HTML-only lint cannot satisfy the gate.

`<p>` is `tiktok` for TikTok deliverables, `instagram_reels` for
Meta, `youtube_shorts` for Shorts, etc. The lint runs all rules
(safe-zone, glyph-clip, layout-axis-coherence, color-grade-coherence,
text-readability, audio-presence, static-frame-trim) and exits
non-zero if any Error-severity finding lands.

If lint reports errors, remediate then re-run:

- **safe-zone** — lift the offending element above the platform's
  chrome margin (bottom 320 px on TikTok 1080×1920, etc.).
- **glyph-clip** — revise the scene's CSS (padding, overflow,
  font-size) so text doesn't escape its container or the canvas.
- **text-readability** — bump cap-height to ≥ 56 px at 1080×1920
  (or the scaled equivalent for 9:16 deliverables); check contrast
  ratio ≥ 4.5:1 against the underlying video frame.
- **audio-presence** — confirm an `<audio>` ref is present in
  `commercial.html` AND the referenced music file exists on disk.
- **color-grade-coherence** — rewrite the storyboard prompts to
  share the cinematography preamble verbatim (see the
  Shot-prompt-prefix section). The fix is upstream, at the
  storyboard stage — not in the composition.

After fixing, re-run `wavelet lint` and confirm exit 0. Only then
write `notes.md` and call the run done.

If lint exit is non-zero and the agent ships anyway, the rubric
WILL catch the visible failures (off-screen text, color drift,
microscopic copy, missing audio) and the run fails. The lint exists
specifically to prevent paying for re-rolls.

The 005 v5 run did NOT invoke `wavelet lint` even once — every
layout problem in the rendered MP4 was something the lint would
have caught at the compose stage. Don't be that run.

## Step 8 — render and (optionally) re-mux

```bash
wavelet render index.html -o commercial.mp4
```

When the composition has audio cues, render emits a sidecar `.wav`
alongside the video. If you need a finer-grained audio path (different
codec, additional ducking, ffmpeg-side normalization), re-mux:

```bash
ffmpeg -y -i commercial.mp4 -i commercial.wav \
  -c:v copy -c:a aac -b:a 192k -shortest \
  commercial.muxed.mp4
```

## Step 8.5 — provenance signing (C2PA)

EU AI Act Article 50 enforcement begins **August 2026**. Sign at render time:

```bash
wavelet render index.html -o commercial.mp4 \
  --sign-c2pa --title "Brand spot v3" --author "Studio name"
```

Or retroactively:

```bash
wavelet c2pa sign commercial.mp4 -o commercial.signed.mp4 \
  --comp index.html --title "Brand spot v3" --author "Studio name"
wavelet c2pa verify commercial.signed.mp4
```

The bundled test cert chains to a non-trusted root — fine for
development, not for delivery. For production, BYO cert chain that
traces to a C2PA-trusted root via `--signing-cert` + `--signing-key`.

## Step 8.6 — optional premium finish (Topaz Astra 2)

Manual post-step. Drag `commercial.mp4` into Topaz Astra 2, pick the
`Proteus` preset, export to `commercial.astra.mp4`, then re-sign:

```bash
wavelet c2pa sign commercial.astra.mp4 --comp index.html
```

Astra's re-encode invalidates the original C2PA hash, so re-signing
is mandatory.

## Step 8.7 — UGC post-realism pass (when register == UGC)

For UGC-register spots only. Skip on cinematic / luxury / editorial
output — they're the wrong direction for those. The pass is "the
final 10%" the community converges on (aiimagetovideo.pro, reelmind,
renderio — 2025-2026): even with a Nano-Banana-3 ref + the "A selfie
video of" scaffold + UGC negatives, Veo's output is *still* too
clean. Real phone footage carries sensor noise, lens optics, and
TikTok-codec artifacts; AI gen carries none of them. Layering them
in post moves the clip out of uncanny valley.

The minimum effective stack — one ffmpeg call:

```bash
# Adds varied film grain, slight barrel + chromatic aberration,
# re-encodes at TikTok-ish bitrate (~7 Mbps for 1080×1920).
# Tune the `noise` and `lenscorrection` strengths per shot — grain too
# heavy reads as a filter, too light reads as nothing.
ffmpeg -y -i commercial.mp4 \
  -vf "noise=alls=8:allf=t,\
       lenscorrection=k1=-0.02:k2=-0.01,\
       chromashift=cbh=1:crv=-1,\
       format=yuv420p" \
  -c:v libx264 -preset slow -b:v 7M -maxrate 8M -bufsize 16M \
  -c:a copy commercial.ugc.mp4
```

Notes on each filter:

- `noise=alls=8:allf=t` — temporal noise, varied per-frame. The `f=t`
  flag is load-bearing; static (per-pixel) noise reads as a filter.
- `lenscorrection=k1=-0.02:k2=-0.01` — subtle barrel distortion;
  iPhone wide-angle selfie lenses produce ~k1=-0.04, the smaller
  number reads as "phone" without becoming GoPro-fisheye.
- `chromashift=cbh=1:crv=-1` — 1px chromatic aberration; ~0.5px is
  ideal but ffmpeg's filter takes integer pixels.
- `-b:v 7M` — TikTok's effective bitrate ceiling on uploads is
  ~6-8 Mbps. Targeting it here kills the too-clean codec signature
  before the platform's encoder gets to do it for you.

Run **after** `wavelet render` + final mux, **before** C2PA signing
(C2PA's hash binds the file you intend to ship — sign the post-pass
output, not the pre-pass one). If using Topaz Astra, run Astra
**before** this step; Astra's job is upscaling, this pass's job is
adding the right kind of dirt back in.

A heavier stack (FilmConvert + Magic Bullet Looks via Resolve) is
the manual professional finish, but the ffmpeg one-liner above is the
agent-runnable floor that converts an obviously-AI talking-head into
something that survives a first-pass viewer check.

## Step 8.8 — real-product-label compositing (when the SKU label matters)

If the brief names a real branded product with a wordmark or label
that viewers will recognize (skincare, food/bev, electronics with
visible badges), **never trust Veo to render the label**. Even
Veo 3.1's Ingredients-to-Video workflow (3 reference images, with
the product image first in the order) hallucinates letterforms
frame-to-frame, and the standard advice from Google's own ref-image
docs is to "use the generated clip as motion material and overlay
official text in editing."

**Read the product specifics from brandwork before prompting.** The
agent's instinct is to fill product details from imagination
("pastel pink-and-cream squeeze tube of moisturizer"); the brandwork
output usually has the real ones. Specifically: `brandwork brief
<domain> --json` returns `brand.palette` (hex array) +
`brand.descriptors_json.description` which usually includes the
product packaging form factor + dominant colors. For Bubble it
returns `["#241c21", "#040404"]` palette with "turquoise jar with
orange pump cap" findable via `brand fetch` social images.
Translate those values verbatim into the Veo prompt's product slot —
do NOT substitute your own guess. The 010 v3 eval shipped a cream
squeeze tube for a brand whose actual product is a turquoise jar
with an orange pump cap. That's a brand-research-to-prompt
propagation failure, not a Veo failure.

The agent-runnable approach:

1. Generate the shot with Veo Ingredients-to-Video — front-load the
   preservation clause: *"Using the reference image as the identity
   anchor, create a 4-second video of [SUBJECT holding the product].
   Preserve the bottle shape, cap color, and label region. Do not
   change the logo, label, bottle shape, or cap color."*
2. Accept that the label TEXT will still drift. The bottle shape +
   color usually survives; the wordmark glyphs do not.
3. In post (After Effects with mocha, DaVinci Fusion's Planar
   Tracker, or `wavelet shot fix --intent "replace label region
   with reference"` for a Kontext-Max surgical pass), planar-track
   the label region and comp the real product PNG / SVG wordmark
   back on top.
4. The real wordmark URL comes from `brandwork brand.product
   domain=<x> query=<sku>`. Do NOT text-render the brand name in
   the brand's display face as a substitute — that reads as
   deliberate typography, not as a real label.

Gotcha: this only works if the label region is reasonably stable
between frames. On rapid-motion clips (subject waving the bottle
around) the tracker loses lock and you need to either (a) re-roll
the shot with calmer motion, or (b) limit the label-track to the
sub-window of the shot where motion is stable.

For brand-label fidelity over animation, use Veo `i2v` with a
pre-rendered first/last frame containing the correct label (see
"Text baked into Veo clips" near the end of this skill) — Veo
interpolates between known-good label states rather than
hallucinating from scratch.

## Verifying the result

Extract a frame from the rendered video and spot-check:

```bash
ffmpeg -ss 1.5 -i commercial.mp4 -vframes 1 frame.jpg
```

Confirm: the expected scene's subject is visible, the HTML overlay is
readable, the frame matches the AI-generated content (not a fallback).
Pull a frame at each scene boundary (0.5s, mid-scene, last 0.5s) to
verify the CSS animations actually played.

## Budget guidelines

Default ceiling: **$5.00 total** for a 12-second commercial on the
Google-direct stack.

- Music (12s × Lyria 3 Pro $0.001/s): ~$0.01
- Stills (4-6 × Nano Banana 3 $0.04): $0.16-0.24
- Shots (4-6 × Veo 3.1 Fast at 5s × $0.05/s = $0.25/shot): $1.00-1.50
- Hero upgrade (1-2 shots × Veo 3.1 at 5s × $0.15/s = $0.75/shot): $1.50
- Re-render: free (cache hits)
- Re-generate one shot: $0.25
- Final mux: free

Always pass `--max-cost <N>` on every billed call. The CLI refuses
requests where estimate exceeds the budget.

## File layout convention

```
/tmp/wavelet-commercial/
  brief.md
  script.fountain
  screenplay.json
  velocity.json
  storyboard.json
  transitions.json
  music/
    track.wav
  vo/
    line.wav            (optional)
  eases.css             (the :root block from skills/wavelet-director/eases.css)
  scenes/
    01-title.html
    02-canyon.html
    03-vista.html
    04-road.html
  shots/
    shot-1-saguaro.mp4
    shot-2-canyon.mp4
    shot-3-sedona.mp4
    shot-4-road.mp4
  index.html            (the multi-scene manifest — feed this to wavelet render)
  commercial.mp4        (the deliverable)
  commercial.wav        (sidecar audio if you need to re-mux)
```

## Common pitfalls

- **Stock-looking generated shots:** Prompts too generic. Add subject
  specifics, composition, camera type. Not "a desert" — "a single
  saguaro silhouetted against a flame-orange sunset, mountains on the
  horizon, wide low-angle, cinematic".
- **Black frames in render:** Your inline `<video src="...">` path
  in the scene HTML didn't resolve. Scene-HTML paths are relative to
  the scene file itself (typically `../shots/shot-N.mp4` since scenes
  live in `scenes/` and shots in `shots/`). If you wrote
  `data-video-bg` on a `<section>` instead of an inline `<video>`,
  the clip is orphaned — `data-video-bg` is silently dropped by the
  renderer; only inline `<video>` inside scene HTML renders.
- **Audio out of sync:** Music duration must equal total render
  duration. Generate music to match (`--duration <total_secs>`) or use
  `<audio data-spans="all">` to bind to the comp's duration explicitly.
- **Continuity check fails:** Two adjacent shots cross the 180° line.
  Reorder shots in the screenplay or add a `WHIP PAN TO:` /
  `SMASH CUT TO:` between them.
- **Veo output doesn't match prompt:** Re-roll with a different seed
  (`--seed <N>`) or rewrite the prompt to be more specific.
- **Animations don't play in the rendered MP4:** Verify the scene HTML
  uses standard CSS `@keyframes` (not the retired `motion: [...]` JSON
  format). Stylo runs the clock per-frame; bad `cubic-bezier()`
  arguments outside `[0,1]` for x-axis silently fall back.
- **Spot looks like every other AI ad:** You used the AI-default
  lockup. Same Inter-88px-bottom-left across all four scenes, no
  `clip-path`, no `mix-blend-mode`, every animation on plain `ease`.
  Go back, vary the typography per scene, reach into the extended
  ease table on at least two cuts, use `mix-blend-mode: difference`
  on at least one title.
- **`filter: blur(8px)` did nothing:** Filter support hasn't landed —
  see "What does NOT work". Pre-blur the underlying shot in the image
  gen prompt, or accept the overlay can't blur the backdrop.
- **`background-clip: text` didn't apply a gradient to type:** Same —
  not shipping yet. Render the gradient as the element's background
  (solid type, gradient field) or move to an SVG `<text>` with
  `<linearGradient>` fill.

## Multi-backend overrides — for when Google's defaults don't fit

Power-user territory. The Google-direct stack is the default for image,
video, and music; every billing-relevant CLI verb accepts a `--backend`
flag that swaps in an alternate provider for that one call. No skill
narrative covers these — they're escape hatches, not workflows.

Image (`wavelet shot still --backend …`): `google-nano-banana-3` (default).
Video (`wavelet shot txt2vid --backend …`): **`fal-veo3-fast` (default)** —
$0.25/s × 4 s = **$1.00 per 4-second clip**. Routes through Fal's queue
API. Allocate `--max-cost 1.20` (≥ 1.20) on every shot or the cost gate
refuses with `estimated cost $1.00 exceeds budget $0.X`. Alternates:
`fal-veo3` (Standard, $0.50/s = $2/4s); Google direct
`veo` / `veo-fast` / `veo-lite` — these are CURRENTLY QUOTA-EXHAUSTED
and will fail with HTTP 429 RESOURCE_EXHAUSTED; do not use until quota
resets.
Music (`wavelet music gen --backend …`): `elevenlabs` (Merlin+Kobalt-licensed),
`udio`.

**Budget allocation for an 8-shot 12-second commercial:**
Default fal-veo3-fast costs $1/clip × 8 clips = $8 of video gen. Add
music ($0.05) + any TTS ($0.10) + img2vid stills ($0.50) ≈ $9 total.
A $10 budget fits with margin; a $5 budget does NOT — reduce to 5
shots or get the budget raised before generating.

Pick an override when (a) the default model is rate-limited or down,
(b) you need a specific provider's idiosyncratic output (ElevenLabs
Music's stem isolation, Udio's vocal character), or (c) you're
benchmarking the defaults against alternates. Otherwise stay on
defaults — fewer env vars, fewer broker handoffs, lower cost.

## Text baked into Veo clips (wb-lzat)

Full research at `packages/wavelet/docs/veo-text-prompting.md`.

Veo text fidelity is a **known, unresolved limitation** through Veo 3.1.
The three most actionable findings:

1. **Genre descriptors, not font names.** There is no documented evidence
   that specific typeface names ("Helvetica Black", "Druk") change Veo
   output. Use style terms instead: `"bold white sans-serif font"`,
   `"heavy condensed uppercase lettering"`, `"clean geometric sans"`.

2. **i2v two-frame interpolation is the recommended path for wordmarks.**
   Pre-render the text frame (CSS overlay screenshot or compositor output),
   feed it as the end frame to `wavelet shot i2v`. Veo animates the
   transition without hallucinating letterforms from scratch.

   ```bash
   wavelet shot i2v --first clean-scene.png --last wordmark-hold.png \
     --prompt "the word 'NEW BALANCE' assembles from black paint brushstrokes,
               50mm, warm studio light" \
     --duration 4
   ```

3. **For txt2vid text: short, all-caps, flat surface, stable camera.**
   Keep strings to 1-3 words. Curved surfaces and camera movement cause
   letterforms to drift frame-to-frame. Use `"head-on framing, no motion
   blur"` and a dedicated close-up shot when text must be in-shot.

After generation, run `wavelet image ocr` on a sampled frame to grade
legibility before accepting the clip — the same OCR rule that grades the
008 eval output.

**Anti-pattern (008 trigger):** Asking Veo to `"bake in the NEW BALANCE
wordmark forming from paint"` in a single txt2vid call will hallucinate
letterforms. Use i2v or composite the wordmark as a CSS overlay scene
instead, and reserve txt2vid for the motion background.

## When you're done

Report:

- Path to the final muxed MP4
- Total billed spend
- Which generation steps succeeded / required retry
- Anything in the brief you couldn't honor (and why)

Don't open the file for the user — they'll do that themselves.

---

*Last updated 2026-05-23 — closes bd issue **wb-ndw7** (child of epic
wb-e8jh); adds Veo text-prompting research (**wb-lzat**). Verify the
"shipping today / coming soon" lists in this doc against the current
state of `vendor/blitz-paint/src/render/` and
`packages/wavelet/src/compose/` on every release; this file describes
the palette as of that date.*
