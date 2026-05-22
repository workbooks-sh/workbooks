# `design.md` — the deck plan doc

For any deck that isn't trivial, write `design.md` BEFORE
generating any slides. Get the user's sign-off on the arc first.
Restructuring a 25-slide deck costs 10× what agreeing on the
outline upfront costs.

The trigger is in SKILL.md:
- > 5 slides → write design.md
- Named audience → write design.md
- Multi-section → write design.md
- Otherwise (3-slide standup, single quick visual, "explain this
  in 5 slides") → skip it

The doc lives at the root of the workbook project alongside
`workbook.config.mjs`. It's NOT bundled into the built `.html`
(it's a planning artifact for authors and agents, not a recipient-
facing thing).

---

## The template

Copy this skeleton into `design.md`, fill in EVERY section. Empty
sections mean unanswered questions, and unanswered questions
become deck failures.

```markdown
# Deck plan: <title>

## Audience

Who is in the room?
- Role(s):
- What they know already:
- What they want from this deck:
- What they walk away saying (in their own words):

## Takeaway

If they remember ONE thing, it's:
<one sentence, ideally one clause>

## Framework

Which narrative frame:
<Minto / SCQA / Pixar Story Spine / Duarte contrast / Kawasaki 10/20/30 /
 Sequoia / Jobs / BBP 5-act / TED arc>

Why this one:
<one sentence — what about the context picked it>

## Design / theme

**Required.** Design the deck's visual identity before you write
slides. Not "pick a preset" — there isn't one. Decide the actual
design choices below and capture the rationale.

- **Voice in one phrase:** <"clinical / restrained" or "warm /
  human" or "high-contrast / dramatic" — what the audience should
  feel before they read any words>
- **Dominant color (hex):** <…>
- **Accent color (hex):** <…>
- **Background (hex):** <near-white for light, near-black for dark>
- **Body text (hex):** <AAA contrast against bg>
- **Display font:** <name + fallback stack, OR "system serif"
  / "system sans" / "system mono">
- **Body font:** <same>
- **Per-archetype identity moves** (≤3, optional): e.g. "drop-cap
  on first paragraph of content slides", "hairline rule above and
  below section titles", "lime accent badge on process step numbers"

## Story arc

One sentence summarizing the journey from slide 1 to slide N:
<"We start with X, the audience feels Y, we reveal Z, they leave wanting W.">

## Slide-by-slide outline

Title only per slide. Don't write content yet. Group by section
break.

### Open
1. [title] <deck name>
2. [content] <one-sentence point>

### Section 1: <name>
3. [section] <section name>
4. [content] <one-sentence point>
5. [stat] <the number>
6. [content] <next point>

### Section 2: <name>
7. [section] <section name>
…

### Close
N-1. [demo] <what we show>
N. [qa] <closing line>

## Visual direction

- **Palette:** dominant <#hex>, accent <#hex>, neutrals <#hex>, <#hex>
- **Display font:** <name>
- **Body font:** <name>
- **Mood:** <one phrase — "clinical / restrained", "warm / human", "high contrast / dramatic">
- **Theme:** light / dark

## Logo inventory

Brands referenced in the deck and where they're sourced:
- <brand> — <source: lobehub / svgl / simple>
- …

## Demo plan

For each `demo` slide:
- **Slide N:** <what's shown> · fallback: <screenshot / video filename> · pre-warm: <yes/no>

## Anticipated Q&A

Questions you expect to be asked. Backup slides covering them
get tagged in the deck.
- <question>
- <question>

## Decisions deferred / open

Anything where you need a decision before slides can be written.
- [ ] <decision needed>
- [ ] <decision needed>
```

---

## How to use it as the author

1. Fill the template.
2. Share with the user / stakeholder. Get explicit signoff on
   **audience**, **takeaway**, and **slide-by-slide outline**.
3. Start writing slides only after sign-off.
4. As the deck takes shape, update `design.md` if you discover
   the outline is wrong — the doc and the deck should stay in
   sync. If they drift, future-you (or another author iterating
   on the deck) loses the rationale.

---

## How to use it as an agent

When the user asks for a deck that meets the trigger criteria:

1. **Don't generate slides yet.** Draft `design.md` and present
   it.
2. **Surface the open questions explicitly.** "Before I build
   this, I need to know: who's the audience? What's the one
   takeaway?" Don't guess; ask.
3. **Recommend a framework** with a one-sentence justification.
   Let the user override.
4. **Propose the slide-by-slide outline** as titles only. Get
   sign-off.
5. **Then** generate slides, working slide-by-slide against the
   outline. Reference `design.md` for archetype, framework
   commitments, visual direction.
6. **Update `design.md`** if the deck evolves away from it during
   construction.

The doc is the contract. Slides are the implementation.

---

## What a filled-out `design.md` looks like

A real, abbreviated example for context:

```markdown
# Deck plan: Q3 2026 board review

## Audience

- Role(s): 5 board members, 2 investors, 3 internal execs
- What they know already: monthly metrics dashboard, last quarter's
  miss on revenue
- What they want: confidence we've fixed the Q2 problems + a
  credible plan for Q4
- What they walk away saying: "They know what went wrong, they
  fixed it, and the Q4 plan is real."

## Takeaway

Q3 fixed the unit economics problem; Q4 is about distribution.

## Framework

Minto — board wants the answer first, evidence second.

Why: time-constrained audience, decision-oriented, no need for
emotional buildup.

## Design / theme

- Voice in one phrase: clinical / restrained — feels like an
  internal RFC, not a launch.
- Dominant: #1F2937 (slate-800)
- Accent: #F59E0B (amber-500)
- Background: #FAFAFA (near-white)
- Body text: #1F2937 (matches dominant — single ink)
- Display font: IBM Plex Mono (with system mono fallback) — the
  monospace cue signals "this is a numbers doc"
- Body font: Inter (with system sans fallback)
- Per-archetype moves:
  - stat slides: amber underline below the giant number
  - section slides: thin amber rule above + below the title
  - process steps: amber numerals at 1.5× body size

## Story arc

Open with "Q3 was a recovery quarter." Walk through the three
moves that made it so. Land on "Q4 is about scaling, here's the
plan." Close with the ask (budget approval for distribution hire).

## Slide-by-slide outline

### Open
1. [title] Q3 2026 Board Review
2. [content] Headline: Q3 fixed Q2's problem.

### Section 1: The three moves
3. [section] What we did in Q3
4. [stat] 3.2× revenue per customer
5. [content] Move 1: pricing reset
6. [content] Move 2: ICP narrowed
7. [content] Move 3: churn intervention rolled out

### Section 2: Where this leaves us
8. [section] Where we are now
9. [comparison] Q2 vs Q3 unit economics
10. [content] What's still broken (and OK with that)

### Section 3: Q4 plan
11. [section] Q4: from recovery to scaling
12. [process] The 3-step distribution plan
13. [stat] Target: 2× monthly net-new logos
14. [content] What we need: 2 hires + $400K budget

### Close
15. [qa] Questions

## Visual direction
- Palette: dominant #1F2937, accent #F59E0B, neutrals #FAFAFA, #6B7280
- Display: Inter
- Body: Inter
- Mood: clinical / restrained
- Theme: light

## Logo inventory
- (no external brands referenced)

## Demo plan
- (no live demos)

## Anticipated Q&A
- "What's the customer-acquisition cost on the new ICP?"
- "Have we run a Q4 sensitivity analysis if churn doesn't hold?"
- "When does the new distribution hire start producing?"

## Decisions deferred
- [ ] Final budget number for the hire (waiting on finance)
```

This took 30 minutes to write and prevented at least 4 hours of
slide revisions.

---

## When to skip `design.md`

Skip for:
- Standup decks (3-5 slides, same audience every week)
- Quick visuals to share ("here's the new logo")
- "Explain X in 5 slides" tutorials
- Slides you're prototyping a design idea with, not delivering

Don't skip for:
- Anything you'll spend more than 2 hours building
- Anything with a named audience or stakeholder
- Anything that will be presented live to >5 people
- Anything you'll iterate on across multiple sessions
