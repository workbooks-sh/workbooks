# Motion identity case studies — read for inspiration, then design your own

> These are 8 motion identities from canonical ColorWave
> (`vendor/colorwave/packages/colorwave/src/skills/hyperframes/visual-styles.md`,
> audited in
> `vendor/colorwave/packages/gamut/crates/motion/MOTION.md/NAMED_STYLES_AUDIT.md`).
> They are shown here as **case studies**, not options to pick from.
> Listing them as a checklist is the failure mode this doc is
> warning against.

A previous version of this file framed these eight identities as a
picker — "pick `swiss_pulse` for SaaS, `velvet_standard` for
luxury…" That framing is rejected. **Picking from a fixed menu
over-imposes design choices and produces videos that look generic
for the wrong reason. The agent designs the motion identity from
scratch every time.** The right way to use this file:

1. Read the case studies. Understand *how* each identity emerged
   from the topic, the palette, the easing, the transition logic.
2. Internalize the moves — the rationale for *why* black + amber
   + Helvetica + hard cuts feels like data, not the recipe itself.
3. Go back to your own brief and design your motion identity from
   scratch in `motion.md`. Custom is the only path. There is no
   `style.named:` picker enum the runtime will pattern-match
   against. The agent owns the design.

If you find yourself writing `style.named: swiss_pulse` and
shipping, you're picking from the menu. Stop. Go to
[designing-the-look.md](designing-the-look.md) and design the
identity for THIS video's topic, audience, and channel.

---

## How to read a case study

Each entry below carries:

- **Topic that called for it** — why the identity emerged from the
  brief (not the brief that should pick it).
- **Palette + typography** — the actual hex + font choices, with
  the rationale.
- **Motion signature** — pacing, ease vocabulary, what does and
  doesn't move.
- **Transition pattern** — how shots join.
- **Anti-patterns** — what the identity is NOT, and why.
- **Why it works for THAT topic** — the load-bearing connection
  between the brief and the choices.

The last bullet is the point. Each identity is the answer to one
specific brief. Your brief is different. Read for the *kind of
thinking*, then do that thinking yourself.

---

## Case study 1 — Swiss-Brockmann (clinical data tool)

**Topic that called for it:** an 18-second hero for an analytics
dashboard. Audience is engineering managers comparing tools. The
deliverable has to read "this is rigorous, the numbers are the
point" within the first second.

**Palette + typography:**
- Black (`#1a1a1a`), white, one accent — electric blue
  (`#0066FF`).
- Helvetica Bold for hero numbers (80–120px), Regular for labels.

**Motion signature:** counters count up from 0; nothing floats;
grid-locked compositions where every element snaps to an invisible
12-column grid. Eases: `expo.out`, `power4.out`. Fast arrivals,
hard stops.

**Transition pattern:** hard cuts. Crossfades would soften the
"rigorous" claim.

**Anti-patterns:** decorative gradients, slow elastic eases,
asymmetric layouts.

**Why it works for THAT topic:** the audience is verifying claims.
Hard cuts + locked grid + counter-up animation IS a claim of
precision. A softer identity would undermine the product's pitch.

---

## Case study 2 — Vignelli-grade (premium enterprise keynote)

**Topic that called for it:** a 45-second segment in an investor
keynote for an established enterprise software company. The brief
is "feel like the New York Times masthead, not a SaaS startup."

**Palette + typography:**
- Black, white, one rich accent — deep navy (`#1a237e`) or gold
  (`#c9a84c`).
- Thin sans-serif (Bodoni Sans or Neue Haas Grotesk Light), ALL
  CAPS, wide letter-spacing (`0.15em+`).

**Motion signature:** generous negative space; symmetrical,
centered, architectural precision. Eases: `sine.inOut`, `power1`.
Nothing snaps — everything glides. Sequential reveals with long
holds.

**Transition pattern:** slow cross-warp; the kind of dissolve
that makes the audience exhale.

**Anti-patterns:** fast eases (`expo.out`, `back.out`), high
saturation, kinetic type.

**Why it works for THAT topic:** the brand has been around 40
years. The motion has to communicate institutional weight. Fast
motion would look like a startup imitating an enterprise. The
restraint IS the message.

---

## Case study 3 — Brody-deconstructed (security launch with attitude)

**Topic that called for it:** a 30-second teaser for a security
research firm's annual report drop. Audience is security
researchers and tech press. The brief is "punk, not corporate
PDF."

**Palette + typography:**
- Dark grey (`#1a1a1a`), rust orange (`#D4501E`), raw white
  (`#f0f0f0`).
- Bold industrial weight, type at angles, overlapping edges,
  letters escaping their frames.

**Motion signature:** text SLAMS and SHATTERS — letters scramble
through `steps(8)` then snap to final position. Gritty textures
baked in: scan-lines, glitch artifacts. Eases: `back.out(2.5)`,
`elastic.out(1.2, 0.4)`. Intentional irregularity.

**Transition pattern:** glitch + whip pan.

**Anti-patterns:** centered symmetric layouts, slow sine eases,
"polished" finishes.

**Why it works for THAT topic:** the audience distrusts polished
marketing. The deliberate roughness signals "we're not selling
you, we're telling you." The look IS the credibility.

---

## Case study 4 — Scher-maximalist (consumer launch hype)

**Topic that called for it:** a 15-second hype reel for a
consumer product launch. Audience is the brand's existing
follower base on Instagram and TikTok. The brief is "loud,
unmissable, end on the date."

**Palette + typography:**
- Bold saturated: red (`#E63946`), yellow (`#FFD60A`), black,
  white — maximum contrast.
- Text IS the visual. Overlapping type layers at different scales
  and angles, filling 50–80% of frame.

**Motion signature:** everything kinetic — slamming, sliding,
scaling. 2–3 second rapid-fire scenes. Text layered OVER footage,
never empty backgrounds. Eases: `expo.out`, `back.out(1.8)`.

**Transition pattern:** ridged burn / slam — every cut is a
punch.

**Anti-patterns:** small type, neutral palettes, slow pacing,
static moments.

**Why it works for THAT topic:** the audience is scrolling. You
have ~1 second of attention. Maximum density of contrast + motion
is what survives a scroll. Restraint here = no view.

---

## Case study 5 — Anadol-immersive (AI platform launch)

**Topic that called for it:** a 60-second loop running on a screen
behind a stage at an AI conference. Audience is researchers and
engineers. The brief is "feels like a model thinking."

**Palette + typography:**
- Iridescent: deep black (`#0a0a0a`), electric purple
  (`#7c3aed`), cyan (`#06b6d4`).
- Thin futuristic sans-serif — floating, weightless.

**Motion signature:** fluid morphing compositions; extreme scale
shifts (micro → macro). Particles coalesce into numbers; light
traces data paths through the frame. Eases: `sine.inOut`,
`power2.out`. Smooth, continuous, organic. Nothing hard.

**Transition pattern:** gravitational warp.

**Anti-patterns:** hard cuts, geometric grids, opaque solid
blocks.

**Why it works for THAT topic:** the product is doing
continuous, fluid computation. Hard-cut motion would contradict
the product story. The look IS the demo.

---

## Case study 6 — Sagmeister-warm (wellness brand story)

**Topic that called for it:** a 45-second founder story for a
mental health app. Audience is potential users in a vulnerable
state. The brief is "feel held, not sold to."

**Palette + typography:**
- Warm amber (`#F5A623`), cream (`#FFF8EC`), dusty rose
  (`#C4A3A3`), sage green (`#8FAF8C`).
- Handwritten or humanist serif fonts. Personal, lowercase,
  delicate.

**Motion signature:** close-up framing — single element fills the
frame. Slow drifts and floats, never snaps. Eases: `sine.inOut`,
`power1.inOut`. Everything breathes.

**Transition pattern:** thermal distortion — soft, organic
boundaries between shots.

**Anti-patterns:** harsh contrast, geometric type, fast pacing,
hard cuts.

**Why it works for THAT topic:** the audience's emotional state
is fragile. Aggressive motion reads as marketing. The slow
breathing motion mirrors the calm the product offers.

---

## Case study 7 — Terrazas-folk (community product launch)

**Topic that called for it:** a 30-second launch for a
recipe-sharing app. Audience is food-creators on social. The
brief is "feel like a market on a Saturday, not a tech demo."

**Palette + typography:**
- Vivid folk: hot pink (`#FF1493`), cobalt blue (`#0047AB`), sun
  yellow (`#FFE000`), emerald (`#009B77`).
- Bold warm rounded type. Pattern and repetition.

**Motion signature:** layered compositions with rich visual
texture — every frame feels handcrafted. Elements bounce, pop,
and spin into place. Eases: `back.out(1.6)`,
`elastic.out(1, 0.5)`. Overshoots feel intentional.

**Transition pattern:** swirl vortex / ripple.

**Anti-patterns:** monochrome palettes, brutalist type,
restrained motion.

**Why it works for THAT topic:** the product is about
celebration. Restraint would feel cold. The visual abundance
matches the product's emotional content.

---

## Case study 8 — Hillmann-cinematic (investigative reveal)

**Topic that called for it:** a 40-second teaser for an
investigative documentary. Audience is the documentary's existing
viewers + press. The brief is "dread, then the title."

**Palette + typography:**
- Near-monochrome: deep blacks (`#0a0a0a`), cold greys
  (`#3a3a3a`), stark white + blood red (`#C1121F`) or toxic green
  (`#39FF14`).
- Sharp angular text like film noir title cards. Heavy contrast.

**Motion signature:** heavy shadow — elements emerge from
darkness. Slow creeping push-ins, dramatic scale reveals, silence
before the hit. Eases: `power4.in` for exits, `power3.out` for
dramatic reveals. The pause before the hit matters.

**Transition pattern:** domain warp / slow fade-in.

**Anti-patterns:** light backgrounds, joyful motion, busy
compositions.

**Why it works for THAT topic:** the reveal IS the narrative.
The motion holds the audience in the held-breath state the
content depends on.

---

## What this skill is NOT giving you

This is **not a `style.named:` picker enum**. The earlier version
of motion.md suggested writing `style.named: swiss_pulse` and
expecting the runtime to do something with it — the runtime does
not pattern-match against these names. They are case studies in a
reference doc, not API values.

If a brief is genuinely close to one of these — say, a clinical
data tool that legitimately wants the Brockmann treatment — fine,
borrow the palette + ease vocabulary. But the next clinical data
tool's video should NOT look identical to the first. The brief is
different. The audience is different. The motion identity should
be different too.

The pattern to use, every time:

1. Read the brief.
2. Read the topic, the audience, the channel, the takeaway.
3. Design the motion identity *for that*. In `motion.md`. From
   scratch.
4. Borrow vocabulary from the case studies if and only if it
   genuinely fits, and make it your own.

See [designing-the-look.md](designing-the-look.md) for the
process.
