# `design.md` — the video workbook plan doc

For any video workbook that isn't trivial, write `design.md`
BEFORE generating any gamut HTML. Get the user's sign-off on the
arc, scene list, and motion identity first. Rebuilding a
90-second video with 30 scenes costs 4× what agreeing on the
outline upfront costs.

The trigger is in SKILL.md:
- > 1 composition → write design.md
- > 30 seconds total → write design.md
- Named audience or distribution channel → write design.md
- Otherwise (a 5-second title card, a quick demo clip) → skip

The doc lives at the root of the workbook project alongside
`gamut.html` and `motion.md`. It's NOT shipped to recipients
(planning artifact, not recipient-facing).

`design.md` answers the *what* and *for whom*. `motion.md`
answers the *how it moves and feels*. The two are sibling docs —
write `design.md` first, then `motion.md` referencing it.

---

## The template

Copy this skeleton into `design.md`, fill in EVERY section. Empty
sections mean unanswered questions, and unanswered questions
become video failures.

```markdown
# Video plan: <title>

## Audience

Four questions. Answer each in one sentence.

- **Role / segment:** <who, specifically>
- **What they know already:** <the floor we're building from>
- **What they want:** <why they pressed play>
- **What they walk away saying (in their own words):**
  <the line you want them to repeat back>

## Channel + format

- **Channel:** <YouTube / TikTok / website hero / sales email link /
  pitch deck embed / conference YouTube / internal Slack>
- **Aspect:** <16:9 / 9:16 / 1:1>
- **Duration target:** <Xs>
- **Audio context:** <plays with sound / muted by default / either>
- **Distribution moment:** <when in the recipient's day this lands>

## Takeaway

If they remember ONE thing, it's:
<one sentence, ideally one clause>

This is the line they should be able to say back. If it takes
two sentences, the takeaway isn't sharp enough.

## Video type

Which type from [types.md](types.md):
<sales pitch / product demo / explainer / interview clip / brand
spot / social ad / talk recap / corporate / pitch video>

Why this one:
<one sentence — what about the brief picked it>

## Framework

Which narrative frame:
<Hook–Promise–Payoff / Problem–Solution / Three-Act / Before-After /
Single-Statement Manifesto / Pull-quote / Minto / SCQA>

Why this one:
<one sentence — what about the type + audience picked it>

See [frameworks.md](frameworks.md) for the full list and how to
pick.

## Motion identity (REQUIRED — link to motion.md)

The full identity lives in `motion.md`. This section is the
two-sentence summary so a reader of design.md gets the gist.

- **Feel in one phrase:** <"cool, exact, just barely fast" or
  "warm, slow, breathing" or "loud, kinetic, unmissable">
- **Dominant color (hex):** <…>
- **Accent color (hex):** <…>
- **Background (hex):** <…>
- **Body text (hex):** <…>
- **Display font:** <name + fallback>
- **Body font:** <name + fallback>
- **Pacing default:** <slow | medium | fast | veryfast>
- **Default transition:** <hard-cut | crossfade | dip-to-bg | …>
- **Per-archetype moves (≤3):** <e.g. "hero shot uses staging
  with `power3.out`", "tag shot holds 1.5s with no motion",
  "captions use cyan caption-active on dark navy bg">

**No preset names here.** This is not "swiss_pulse" — this is the
actual decision for THIS video. The eight case studies in
[visual-styles.md](visual-styles.md) are for inspiration only;
the identity is custom-designed every time. See
[designing-the-look.md](designing-the-look.md) for the process.

## Story arc

One sentence summarizing the journey from frame 1 to frame N:
<"We open on X, the viewer feels Y, we reveal Z, they leave
wanting W.">

## Composition outline (NOT script — the shape)

A single `gamut.html` is the deliverable. Inside it, the
`<gm-timeline>` may break into logical sections (intro / main /
outro) — either as adjacent `<gm-scene>` runs on one timeline,
or as separate sub-files included via `<gm-composition src=…>`.
Pick one approach per project; sub-files only pay off when a
section is reused or authored independently.

List the sections here in one sentence each. Don't write the
script yet.

1. **`intro`** — <one sentence>. Duration: <Xs>.
2. **`main`** — <one sentence>. Duration: <Xs>.

## Scene list (per section)

For each section, list every scene. One line per scene:
**intent + camera/visual + duration estimate**. A scene here is
a `<gm-scene>` (or a tight cluster of overlapping scenes) on the
timeline — the beat the viewer registers as one shot in the
storytelling sense. Don't write the HTML yet.

### intro — 8s total
1. [0–2s] **hook** — text-flash claim, center, hard-cut in.
2. [2–5s] **promise** — wide text, fade in, hold.
3. [5–8s] **tag** — brand mark + URL, dip-to-bg out.

### main — 60s total
1. [0–8s] **problem** — talking head over b-roll, lower-third.
2. [8–20s] **complication** — animated stat scene, anticipation
   ease on the number.
3. [20–40s] **demo** — screen recording with hotspot overlay,
   pause-on-interact.
…

## Asset inventory

Everything you need to gather before HTML starts. Check off as
they land.

- [ ] **Video clips:** <list of source clips + where they come from>
- [ ] **Images / logos:** <list — cross-ref [logos.md](logos.md);
      logos load as `<gm-asset kind="image">` entries>
- [ ] **Fonts:** <list, with weights, inlined as base64>
- [ ] **Music:** <track, license, file location>
- [ ] **VO files:** <recorded audio per composition>
- [ ] **Transcripts:** <SRT / VTT / words.json per VO clip>
- [ ] **B-roll:** <list of cutaways needed>

## Audio plan

- **Music:** <track, license, fade-in/out timing per composition>
- **Voiceover:** <script status — written / recorded / not needed>
- **VO voice:** <human / TTS engine + voice id>
- **SFX:** <list of accent sounds + where they land>
- **Ducking rule:** <music ducks under VO by N dB / no ducking /
  music silent during VO>
- **Captions burned vs. live:** <one per composition>

## Interactive components (if any)

For each interactive shot, declare what mounts and what the
fallback is. Cross-ref
[interactive-components.md](interactive-components.md).

- **Shot N:** <what's mounted> · fallback: <poster file> ·
  pause-on-interact: <yes/no>

## Render plan (placeholder for the future MP4 export ticket)

- **Browser playback only?** <yes / will need MP4 export>
- **If MP4:** screen-record the player (Cmd+Shift+5 on macOS) OR
  hand off to the desktop colorwave renderer once render-to-MP4
  ships.
- **Aspect re-exports:** <list other aspects to export — gamut
  has no native cross-aspect block today, so re-cut by editing
  the `resolution`/`aspect` on `<gm-doc>` and reflowing scene
  layout per target>
- **Captions baked into MP4?** <yes / no — runtime captions only>

## Anticipated Q&A or deferred decisions

Questions or decisions outstanding before the build can ship.

- [ ] <decision needed>
- [ ] <question to answer with the user>
```

---

## How to use it as the author

1. Fill the template. Don't skip sections; flag opens explicitly.
2. Write `motion.md` referencing the design.md's motion-identity
   summary. The two stay in sync.
3. Share both with stakeholders. Get explicit sign-off on
   **audience**, **takeaway**, **shot list**, and **motion
   identity**.
4. Gather assets in the inventory before writing any HTML.
5. Write `gamut.html` — lay out the `<gm-timeline>`,
   `<gm-track>`, and `<gm-scene>` elements scene-by-scene
   against the scene list.
6. Fill in each scene's `<template>` HTML/CSS/JS against the
   motion identity.
7. Update `design.md` (and `motion.md`) if the video evolves.

The docs are the contract. `gamut.html` is the implementation.

---

## How to use it as an agent

When the user asks for a video workbook that meets the trigger
criteria:

1. **Don't generate HTML yet.** Draft `design.md` AND
   `motion.md` and present them together.
2. **Surface the open questions explicitly.** "Before I build
   this, I need to know: who's the audience? What's the
   takeaway? Where does this play? What's the feel?"
3. **Recommend a type + framework** with one-sentence
   justifications. Let the user override.
4. **Design the motion identity from scratch** in motion.md.
   Don't write `style.named: swiss_pulse` and ship — the case
   studies in `visual-styles.md` are inspiration, not picker
   values. See [designing-the-look.md](designing-the-look.md).
5. **Propose the scene list** as one-line beats per scene. Get
   sign-off.
6. **Then** generate `gamut.html`, working section-by-section
   and scene-by-scene.
7. **Update `design.md` and `motion.md`** if the video evolves.

---

## A worked `design.md` (real, end-to-end)

A real, abbreviated example — paired with the "Ledger Hero"
motion identity from
[designing-the-look.md](designing-the-look.md).

```markdown
# Video plan: Ledger hero — 22s homepage video

## Audience

- Role / segment: Finance leads at companies with $10M–$500M
  ARR, evaluating close-the-books tooling.
- What they know already: They've heard of "AI for finance" and
  are skeptical. They've evaluated 2–3 competitors.
- What they want: To see in 20 seconds whether this is "another
  AI wrapper" or something with real workflow depth.
- What they walk away saying: "Worth a demo — the numbers thing
  actually looked deliberate."

## Channel + format

- Channel: Homepage hero, above the fold. Auto-plays muted.
- Aspect: 16:9
- Duration target: 22s
- Audio context: muted by default; viewer can unmute. Captions
  burned because most won't unmute.
- Distribution moment: First visit to the marketing site after
  a referral or ad click.

## Takeaway

This tool treats numbers the way finance teams already do —
exact, sourced, no hand-waving.

## Video type

Brand spot (60-second positioning) compressed to 22s. It's
positioning, not a demo or explainer.

Why: the audience is skeptical; we earn the demo by establishing
voice first. A demo on the homepage hero would be premature.

## Framework

Single-Statement Manifesto.

Why: 22 seconds is too short for Hook–Promise–Payoff with any
breathing room. The whole video is one claim, four times,
visually.

## Motion identity (REQUIRED — link to motion.md)

See `motion.md` for full identity. Summary:

- Feel in one phrase: "cool, exact, just barely fast"
- Dominant: #0B0E14 (deep navy-black)
- Accent: #8EE3F5 (electric cyan)
- Background: #0B0E14
- Body text: #E8ECF1
- Display font: Söhne Mono (with ui-monospace fallback)
- Body font: Söhne (with Inter fallback)
- Pacing default: medium (cut cadence 1100ms)
- Default transition: hard-cut (one dip-to-bg between intro and main)
- Per-archetype moves:
  - Hero scene: stage the headline alone — hold it 1.2s before
    any supporting element fades in.
  - Stat scene: tabular-nums on the counter; letter-spacing -0.02em.
  - Tag scene: 1px outline, no fill — restraint.

## Story arc

We open on a single sentence ("the close, on time"). We back it
with three exact numbers from real customers, each held just
long enough to feel earned. We end on the brand stamp, no
overlay.

## Composition outline

Single section, single `gamut.html`. No intro/outro separation —
22s doesn't support it.

1. **`main`** — full hero, claim → 3 stat scenes → brand
   stamp. Duration: 22s.

## Scene list (per section)

### main — 22s total
1. [0–4s] **claim** — single sentence center, hard-cut in,
   staged alone for 1.2s before the cyan hairline draws beneath.
2. [4–9s] **stat-1** — "Day 2" close vs industry "Day 8".
   Counter from 0, tabular-nums.
3. [9–14s] **stat-2** — "94% of journals sourced automatically",
   stat scene with proportional fill bar.
4. [14–19s] **stat-3** — "$0 spent on consultants this close",
   stat scene, dim every other element.
5. [19–22s] **tag** — brand mark + "ledger.tools", 1px outline
   box, no motion on the logo, dip-to-bg in.

## Asset inventory

- [x] Video clips: none (animated typography only)
- [x] Images / logos: ledger.tools brand mark loaded as a single
      `<gm-asset id="logo" kind="image" src="./assets/ledger-tools.svg">`
- [ ] Fonts: Söhne + Söhne Mono — need licensed files, base64-inline
- [x] Music: none (silent — body is "exact, no decoration")
- [x] VO files: none
- [x] Transcripts: none
- [x] B-roll: none

## Audio plan

- Music: none. Silence IS the brand.
- Voiceover: none.
- SFX: none. Audio-on viewers hear nothing; this is intentional.
- Ducking: n/a
- Captions: none (no VO)

## Interactive components

None. The hero shot doesn't earn interactivity at this length.

## Render plan

- Browser playback only? Yes for the homepage. May need an MP4
  for paid-social cutdown later.
- If MP4: screen-record the player. Re-cut a 15s vertical from
  shots 1 + 5 if we want a social ad.
- Aspect re-exports: defer.
- Captions baked into MP4: n/a.

## Anticipated Q&A or deferred decisions

- [ ] Final stat numbers — confirm with customer-success before
      shipping.
- [ ] Brand-mark color: stamp uses dominant text color (#E8ECF1)
      or accent cyan? Default to text color for restraint.
- [ ] Do we A/B test against a version with VO? Defer to first
      week of metrics.
```

This took 25 minutes to write and prevented at least 3 hours of
revision-after-revision on a 22-second video.

---

## When to skip `design.md`

Skip for:

- Single 5-second title cards
- A quick demo clip dropped in a sales-call thread
- Throwaway prototypes you're testing the runtime with
- "Show me what this looks like" exploration

Don't skip for:

- Anything you'll iterate on across multiple sessions
- Anything with a named distribution channel
- Anything where two compositions need to feel like they belong
  to the same workbook
- Anything you'll spend more than 1 hour building

---

## Diff vs. the presentation `design.md`

This template parallels
`workbook-presentation/references/design-plan.md`. Video-specific
additions: **Channel + format** (aspect, duration, audio
context), **Motion identity** (replaces static "Design/theme"
with pacing + transitions + per-archetype motion moves),
**Composition outline + scene list** (replaces slide-by-slide; one
line per scene carries intent + camera + duration), **Asset
inventory** (clips, fonts, music, transcripts), **Audio plan**
(music, VO, SFX, ducking), **Interactive components** (cross-ref
to [interactive-components.md](interactive-components.md) so the
fallback discipline survives planning), **Render plan**
(placeholder for the future MP4 export ticket).
