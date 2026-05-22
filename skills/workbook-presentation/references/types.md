# Presentation types — pick the right kind before you pick the slides

Each type has a typical audience, length, slide count, narrative
frame, and a list of mistakes that kill it. Match what the user
asked for to the closest type before writing `design.md`.

---

## Investor pitch (seed / Series A)

- **Audience:** 1-5 VCs in a room or on Zoom.
- **Length:** 20-30 minutes including Q&A.
- **Slide count:** 10-15.
- **Frame:** Kawasaki 10/20/30 or Sequoia template.
- **Anchor slides:** Problem / Solution / Why now / Market / Traction / Team / Ask.
- **Common failures:**
  - Skipping "why now" (the most-rejected reason after team).
  - Bullet-point team slide. Use faces + 1-line credentials.
  - Hockey-stick projections with no underlying assumption. Investors
    will mentally divide by 10.
  - Hiding the ask. Make the dollar amount and use-of-funds explicit.
- **Don't:** Use the same deck for a discovery call (too pitchy) AND
  a partner meeting (not enough depth). Build two.

---

## Product launch / announcement

- **Audience:** Customers, press, employees. Often mixed.
- **Length:** 30-60 min keynote.
- **Slide count:** 30-60 (faster pacing — many slides go by in
  seconds).
- **Frame:** Steve Jobs structure.
- **Anchor slides:** Problem framing / "There are 3 things" /
  Demos / Pricing / Availability / Closing surprise.
- **Common failures:**
  - Building up to "one more thing" without a real surprise.
  - Demo without a backup video. ALWAYS have a backup video.
  - Reading specs aloud. Specs go on the slide; you talk about
    what they enable.
- **Don't:** Try to be Steve Jobs if you don't have his stage
  presence. The structure works; the cosplay doesn't.

---

## Conference technical talk

- **Audience:** Engineers in a 100-500 person room.
- **Length:** 30-45 minutes.
- **Slide count:** 30-60. Code-heavy slides count differently —
  one slide can hold the room for 3 minutes.
- **Frame:** Beyond Bullet Points 5-act.
- **Anchor slides:** Setting / Role / Thesis / Inciting incident /
  Resolution + lesson.
- **Common failures:**
  - Live coding without a fallback. Always have the finished
    code in a `<Slide kind="code">` to fall back to.
  - Architecture diagrams the audience can't read from row 20.
    Re-draw as multiple progressive slides instead of one busy one.
  - Apologizing for not having time. Cut content instead.
- **Don't:** Use slides as your notes. Slides are for the audience;
  notes are for you (use presenter mode).

---

## Conference idea talk / TED style

- **Audience:** Mixed-discipline, 200-2000 people.
- **Length:** 18 minutes (TED standard) or 15-30 (most others).
- **Slide count:** 15-40. Often image-only.
- **Frame:** TED arc.
- **Anchor slides:** Hook / Idea / Evidence / Application / Closing image.
- **Common failures:**
  - Two ideas instead of one. Ruthlessly split or cut.
  - Text-heavy slides. The audience reads, then stops listening.
    Use one phrase + one image.
  - No memorable closing image. The audience remembers the last
    slide; make it good.
- **Don't:** Use this format for product or sales talks. TED is
  for ideas, not products.

---

## Policy / research conference talk

- **Audience:** Mixed policy + technical, 100-500 people. Researchers,
  journalists, regulators, the occasional industry insider.
- **Length:** 20-30 minutes.
- **Slide count:** 15-25.
- **Frame:** Duarte contrast (what is / what could be) or TED arc.
  SCQA also fits when the talk is "here's a problem the audience
  hasn't focused on."
- **Anchor slides:** A concrete moment that grounds the abstract /
  the data that makes the case / 2-3 named players showing scale /
  what should change / who has to change it.
- **Common failures:**
  - Burying the takeaway in a "background" section. Policy audiences
    want the conclusion early; evidence after.
  - Citing data without sourcing it on the slide. Always include
    the source in a small footer line — this audience checks.
  - Naming villains without naming structural causes. Audiences
    react better to "the system selects for X" than "company Y
    is bad." Even when Y is bad.
- **Don't:** Use this format for an industry pitch. Different room,
  different incentives.

---

## Sales pitch (1:1 or small group)

- **Audience:** A specific prospect with specific stated needs.
- **Length:** 30-45 min including Q&A.
- **Slide count:** 10-20. Customizable per prospect.
- **Frame:** SCQA open → Jobs-structure close.
- **Anchor slides:** Your problem (their words) / What it costs you
  today / Our approach / 2-3 case studies / Pricing / Next steps.
- **Common failures:**
  - Generic deck used for every prospect. The first 3 slides MUST
    use the prospect's name, words, situation.
  - Pricing slide before value slides. Value first, always.
  - No clear next step. End with a calendar invite or a written
    ask.
- **Don't:** Spend more than 5 slides on company background. They
  invited you; they know who you are.

---

## All-hands / internal update

- **Audience:** Your company, 10-1000+ people.
- **Length:** 30-60 min.
- **Slide count:** 20-40.
- **Frame:** Minto (state of the company) or Duarte contrast
  (vision shift).
- **Anchor slides:** Where we were / What we did / Where we are /
  What's next / What you should do Monday.
- **Common failures:**
  - Over-curated narrative that feels like marketing to your own
    team. Be honest about misses; engineers smell PR copy in
    milliseconds.
  - No clear ask. All-hands without "here's what you do
    differently next week" is a movie, not a meeting.
  - Q&A as an afterthought. Plan it as 30% of the time.
- **Don't:** Hide bad news. People know already; covering it up
  costs trust.

---

## Educational lecture

- **Audience:** Students, junior engineers, anyone learning the
  topic for the first time.
- **Length:** 50-90 min.
- **Slide count:** 30-80 (depends on density of examples).
- **Frame:** Linear didactic — intro / theory / worked example /
  exercise / recap. Not a narrative frame; a teaching one.
- **Anchor slides:** Learning objectives (explicit) / Concept /
  Worked example / Pause-and-think / Recap.
- **Common failures:**
  - Skipping the worked example. Theory without "watch me do it"
    doesn't transfer.
  - Cognitive overload — too many new concepts per slide.
    Introduce one new term, use it 3 times, then move on.
  - No assessment of "did this land". Use pause-and-think slides
    or live polls.
- **Don't:** Pretend it's not a lecture. Audiences accept lectures
  when you sign-post them; they hate disguised lectures.

---

## Workshop / training

- **Audience:** Hands-on, ≤30 people.
- **Length:** 2-8 hours.
- **Slide count:** 20-60, used as anchors between exercises (not
  primary content).
- **Frame:** Tell / show / do / debrief cycle, repeated 3-6 times.
- **Anchor slides:** Module intro / Concept / Live demo /
  Exercise prompt / Debrief.
- **Common failures:**
  - Too much slide time, not enough do-time. Slides should be
    ≤30% of the session.
  - Exercises that don't have a clear success criterion. Always
    show the finished state before the prompt.
  - One pace for everyone. Build in stretch tasks for the fast
    half and hint cards for the stuck half.
- **Don't:** Skip the debrief. It's where the learning consolidates.

---

## Quick-reference table

| Type                  | Length     | Slides | Frame           | Critical slide              |
| --------------------- | ---------- | ------ | --------------- | --------------------------- |
| Investor pitch        | 20-30 min  | 10-15  | Kawasaki/Sequoia| Why now                     |
| Product launch        | 30-60 min  | 30-60  | Jobs structure  | Demo (with backup video)    |
| Tech talk             | 30-45 min  | 30-60  | BBP 5-act       | Inciting incident           |
| Idea talk (TED)       | 15-25 min  | 15-40  | TED arc         | The idea (one sentence)     |
| Policy / research     | 20-30 min  | 15-25  | Duarte / SCQA   | Cited data + named players  |
| Sales pitch           | 30-45 min  | 10-20  | SCQA → Jobs     | Their problem in their words|
| All-hands             | 30-60 min  | 20-40  | Minto / Duarte  | What you do Monday          |
| Lecture               | 50-90 min  | 30-80  | Didactic        | Learning objectives         |
| Workshop              | 2-8 hours  | 20-60  | Tell/show/do    | Success criterion           |
