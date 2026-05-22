# Deck plan: What "specialty" coffee actually means

## Audience

- Role(s): ~250 food industry attendees at a conference — mostly business
  + ops people (product, marketing, procurement, CPG operators); a
  minority of buyers who can already cup and know what an 80-point
  score looks like.
- What they know already: "specialty" is a premium-shelf word. Probably
  associate it with Blue Bottle, third-wave aesthetic, $6 pour-overs.
  Most do not know there's a numeric definition, or that the score is
  a cup-by-cup protocol with trained graders.
- What they want from this deck: a clean mental model they can use
  next week — when a vendor says "specialty grade", what does that
  actually claim? How do I tell?
- What they walk away saying (in their own words): "The 80-point
  score is real. Most of what's marketed as specialty doesn't even
  cup at 80. The growers carrying the actual definition aren't the
  brands on the bag."

## Takeaway

"Specialty" is a 100-point cupping score with a numeric floor, not a
marketing tier — and the gap between the technical definition and the
shelf claim is where the value goes.

## Framework

SCQA — Situation (what you've been told), Complication (what the
protocol actually requires), Question (so what does "specialty" really
mean?), Answer (the closing position).

Why: a mixed-discipline audience needs the contradiction set up
explicitly. Walking in with a marketing assumption and getting
contradicted in slide 4 is the engine that makes them lean in for
the next 20.

## Design / theme

- **Voice in one phrase:** craft / editorial — feels like a quality
  food magazine's long-read, not a tech keynote. Warm paper, generous
  margins, a single warm-orange accent borrowed from light roast.
- **Dominant color (hex):** #2B1810 (deep coffee — espresso brown,
  reads almost black on a projector but with warmth)
- **Accent color (hex):** #C8643C (Yirgacheffe light-roast orange —
  the color of a properly extracted shot held to light)
- **Background (hex):** #F5EFE6 (warm paper / unbleached cream —
  NOT white. White is laptop / tech-deck signal.)
- **Body text (hex):** #2B1810 (single-ink — matches dominant, AAA
  contrast on the cream)
- **Display font:** "Fraunces", "Iowan Old Style", "Georgia", serif —
  high-contrast serif with optical-size variation; the kind of letter
  you see on a Tartine cookbook cover, not a SaaS deck.
- **Body font:** "Inter", system-ui, sans-serif — neutral grotesque
  body to keep the serif display feeling premium without doubling
  serifs.
- **Theme runtime value:** `base` — writing custom styles.css.
- **Per-archetype identity moves** (3, capped):
  1. **section slides**: large numeral "01 / 02 / 03" eyebrow above
     the section title, set in the same orange accent — borrowed
     from editorial section dividers.
  2. **stat slides**: the huge number gets a tight underline rule
     in accent orange, plus a small "/ 100" or unit-label to its
     right at a fraction of its size — turns a number into a
     scored result.
  3. **quote slides**: a left-side accent rule + display-serif quote
     with a hanging open-quote glyph in the orange. Quotes are the
     "voice from the trade" moments and should feel pulled out.

## Story arc

We start with the marketing line everyone in the room has accepted.
We reveal there's a real protocol — a number, a method, certified
graders — and most "specialty" on shelves wouldn't cup at that
number. We walk the production reality (altitude, varietal,
processing, defect counts) that the score actually measures. We
close on what the word should mean if it meant what marketing claims,
and what to ask your supplier on Monday.

## Slide-by-slide outline

### Open (Situation)

1. [title] What "specialty" actually means
2. [content] You've been told "specialty" means premium.
3. [quote] "Specialty coffee is the term used to describe coffees of
   the highest quality." — common marketing framing
4. [content] There's a real definition. It's a number.

### Section 1: The protocol (Complication)

5. [section] 01 / The protocol
6. [stat] 80 / 100 — the cupping-score threshold
7. [content] Q graders score on 10 dimensions, blind, in triplicate.
8. [process] How a cupping actually runs (4 steps)
9. [stat] ~5,000 — certified Q graders worldwide
10. [content] Defect count is a hard gate, not a soft penalty.

### Section 2: The production reality

11. [section] 02 / What the score measures
12. [content] Altitude is the cheapest correlate of cup score.
13. [chart] Cup score vs growing altitude — the rough curve
14. [content] Varietal + processing carry the rest of the variance.
15. [comparison] Yirgacheffe vs Huehuetenango vs Sidamo — three
    origins, three flavor signatures
16. [stat] ~10M tons — annual world coffee production
17. [stat] ~20% — share that even claims "specialty"

### Section 3: The gap (Question → Answer)

18. [section] 03 / The gap
19. [content] Most "specialty" on shelves was never cupped.
20. [comparison] What the label says vs what the contract requires
21. [content] What to ask your roaster on Monday.

### Close

22. [qa] Questions

## Visual direction

- **Palette:** dominant #2B1810, accent #C8643C, neutrals #F5EFE6, #8A7968
- **Display font:** Fraunces (serif)
- **Body font:** Inter (sans)
- **Mood:** craft / editorial — warm paper, generous whitespace
- **Theme:** light (warm cream, not white)

## Logo inventory

Brands referenced in the deck and where they're sourced. Auto-pick:

- blue-bottle — auto-pick (likely svgl)
- stumptown — auto-pick (svgl or simple)
- counter-culture — auto-pick (uncertain; may miss)
- onyx — auto-pick (uncertain; may miss — small roaster)
- starbucks — auto-pick (svgl / lobehub)
- illy — auto-pick (uncertain)
- SCA (Specialty Coffee Association) — auto-pick will likely MISS;
  not in any of the 7 sources. Candidate for the curated pack or
  vendoring. Flagged in report.

## Demo plan

- (no live demos — this is a conference talk, not a product launch)

## Anticipated Q&A

- "Is 80 actually the threshold, or is the SCA moving toward a new
  protocol?" — yes, the Coffee Value Assessment is replacing the
  pure cupping form, but 80 is still the practical threshold for
  most contracts.
- "What about commercial-grade coffee scoring 75-79 — is that bad?"
  — no, it's drinkable; "specialty" is a quality tier, not a
  good/bad line.
- "Does the consumer actually taste the difference at the shelf?"
  — yes, in side-by-side cuppings; less reliably blind on retail.
- "What's the price premium at the farmgate vs the shelf?" — wide
  spread, often 10-50% at farmgate for >85 lots, 200%+ at shelf.

## Decisions deferred / open

- [ ] SCA logo: vendor or skip? (Going with: skip + flag — using a
      regulator/association logo without permission is risky and the
      deck makes the point fine without it.)
- [ ] Real chart for slide 13 — using a simple inline SVG sketch of
      the altitude/score relationship; calling it "stylized" in the
      caption rather than citing a single specific dataset.
