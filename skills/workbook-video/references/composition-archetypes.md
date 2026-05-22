# Composition archetypes

A composition is one video. Most workbooks contain 1–3
compositions; the Theater picks between them. These are the
common shapes you'll author. Pick one as the scaffold, then
modify.

Each archetype carries:
- **For:** what kind of content / brief calls for it
- **Shape:** scene/track outline
- **gamut HTML skeleton:** copy-paste starting point
- **Anti-uses:** when NOT to reach for it

See [gamut.md](./gamut.md) for the canonical element reference.

---

## 1. Talking-head + lower-third

**For:** Interview clips, founder messages, customer testimonials,
podcast snippets. Audio is doing the heavy lift; visuals support
identity.

**Shape:** One base track carrying the talking-head clip, one
overlay track with a lower-third name plate and word-highlight
captions driven by a transcript asset.

**gamut HTML skeleton:**

```html
<gm-doc fps="30" resolution="1920x1080" aspect="16:9">

  <gm-asset id="founder-clip"  kind="video"      src="./assets/founder.mp4"></gm-asset>
  <gm-asset id="founder-words" kind="transcript" src="./assets/founder.words.json"></gm-asset>

  <gm-timeline id="main" duration="20s">

    <gm-track id="base" z="0">
      <gm-clip asset="founder-clip" start="0s" in="0s" out="20s"></gm-clip>
    </gm-track>

    <gm-track id="lower-third" z="10">
      <gm-scene id="name-plate" start="1s" duration="4s">
        <template>
          <div class="plate">
            <strong>Jane Doe</strong>
            <span>Founder, Acme</span>
          </div>
          <script>
            gamut.onReady("name-plate", () => {
              gsap.from(".plate", { x: -80, opacity: 0, duration: 0.6, ease: "power3.out" });
              gsap.to(".plate", { x: -80, opacity: 0, duration: 0.5, ease: "power2.in", delay: 3.2 });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="captions" start="0s" duration="20s">
        <template>
          <p class="caption" data-words></p>
          <script>
            gamut.onReady("captions", async () => {
              const res = await fetch(document.querySelector('[data-asset="founder-words"]').src);
              const words = await res.json();
              gamut.onTick("captions", ({ frame, fps }) => {
                const t = frame / fps;
                const active = words.filter(w => w.start <= t && t < w.end);
                document.querySelector(".caption").textContent = active.map(w => w.text).join(" ");
              });
            });
          </script>
        </template>
      </gm-scene>
    </gm-track>

  </gm-timeline>
</gm-doc>
```

**Anti-uses:** Don't use for "talking head AS a hook in an ad" —
the hook needs visual interruption, not a face. Cut to face after
the hook lands.

---

## 2. B-roll + voiceover

**For:** Documentaries, brand films, "founder narrates over
footage" pieces. VO carries the meaning; visuals carry the mood.

**Shape:** One audio track carrying the VO end-to-end, one base
track stitching b-roll clips back-to-back, one overlay for the
closing logo mark.

**gamut HTML skeleton:**

```html
<gm-doc fps="30" resolution="1920x1080" aspect="16:9">

  <gm-asset id="vo"      kind="audio" src="./assets/founder-vo.mp3"></gm-asset>
  <gm-asset id="hands"   kind="video" src="./assets/hands.mp4"></gm-asset>
  <gm-asset id="screens" kind="video" src="./assets/screens.mp4"></gm-asset>
  <gm-asset id="team"    kind="video" src="./assets/team.mp4"></gm-asset>
  <gm-asset id="logo"    kind="image" src="./assets/logo.svg"></gm-asset>

  <gm-timeline id="main" duration="30s">

    <gm-track id="vo" z="0">
      <gm-audio asset="vo" start="0s" duration="30s" volume="1.0"></gm-audio>
    </gm-track>

    <gm-track id="broll" z="0">
      <gm-clip asset="hands"   start="0s"  in="0s" out="6s"></gm-clip>
      <gm-clip asset="screens" start="6s"  in="0s" out="8s"></gm-clip>
      <gm-clip asset="team"    start="14s" in="0s" out="8s"></gm-clip>
    </gm-track>

    <gm-track id="endcard" z="10">
      <gm-scene id="logo-mark" start="22s" duration="8s">
        <template>
          <img class="logo" src="./assets/logo.svg" alt="">
          <script>
            gamut.onReady("logo-mark", () => {
              gsap.from(".logo", { scale: 0.85, opacity: 0, duration: 0.8, ease: "back.out(1.6)" });
            });
          </script>
        </template>
      </gm-scene>
    </gm-track>

    <gm-track id="grading" z="20">
      <gm-adjustment start="0s" duration="30s" filter="contrast(1.05) saturate(0.92)"></gm-adjustment>
    </gm-track>

  </gm-timeline>
</gm-doc>
```

**Anti-uses:** Don't use for product explainers — b-roll over a
"how it works" VO is the cliché everyone skips.

---

## 3. Animated explainer

**For:** SaaS explainers, "what is this" videos, abstract concepts
made concrete. Type and shapes do the explaining; voice or text
overlay frames it.

**Shape:** Many short scenes (5–10), each holding one beat. Heavy
GSAP work inside each scene's `<template>`.

**gamut HTML skeleton:**

```html
<gm-doc fps="30" resolution="1920x1080" aspect="16:9">

  <gm-timeline id="main" duration="60s">

    <gm-track id="beats" z="0">

      <gm-scene id="problem" start="0s" duration="12s">
        <template>
          <h1 class="line">Your team rebuilt the same dashboard four times this quarter.</h1>
          <script>
            gamut.onReady("problem", () => {
              const tl = gsap.timeline();
              tl.from(".line", { y: 40, opacity: 0, duration: 0.8, ease: "power3.out" })
                .to(".line",   { opacity: 0, duration: 0.5, ease: "power2.in" }, "+=10");
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="reframe" start="12s" duration="12s">
        <template>
          <h2 class="big">What if it built itself?</h2>
          <div class="shape"></div>
          <script>
            gamut.onReady("reframe", () => {
              gsap.from(".big",   { y: 60, opacity: 0, duration: 0.7, ease: "back.out(1.6)" });
              gsap.from(".shape", { scale: 0, rotation: -90, duration: 1.1, ease: "elastic.out(1, 0.6)", delay: 0.4 });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="how" start="24s" duration="24s">
        <template>
          <ol class="steps">
            <li>Connect a source.</li>
            <li>Pick a metric.</li>
            <li>Share the link.</li>
          </ol>
          <script>
            gamut.onReady("how", () => {
              gsap.from(".steps li", { x: -80, opacity: 0, duration: 0.6, ease: "power3.out", stagger: 0.5 });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="payoff" start="48s" duration="12s">
        <template>
          <h1 class="tag">Dashboards that ship themselves.</h1>
          <script>
            gamut.onReady("payoff", () => {
              gsap.from(".tag", { letterSpacing: "0.4em", opacity: 0, duration: 1.0, ease: "power2.out" });
            });
          </script>
        </template>
      </gm-scene>

    </gm-track>

  </gm-timeline>
</gm-doc>
```

**Anti-uses:** Don't use when you have real product footage to
show — actual screens beat abstracted shapes every time for
"how does it work."

---

## 4. Social ad (short-form vertical)

**For:** TikTok, Reels, Shorts, paid social. 9:16 vertical, 6–30s
total, captioned, designed for mute-first viewing.

**Shape:** One overlay track sequencing Hook / Promise / Payoff /
Tag scenes, one base track holding the product reveal clip.
Aggressive cut pace, burned captions, hook lands ≤ 2s.

**gamut HTML skeleton:**

```html
<gm-doc fps="30" resolution="1080x1920" aspect="9:16">

  <gm-asset id="product" kind="video" src="./assets/product.mp4"></gm-asset>
  <gm-asset id="logo"    kind="image" src="./assets/logo.svg"></gm-asset>

  <gm-timeline id="main" duration="15s">

    <gm-track id="base" z="0">
      <gm-clip asset="product" start="5s" in="0s" out="8s"></gm-clip>
    </gm-track>

    <gm-track id="overlays" z="10">

      <gm-scene id="hook" start="0s" duration="2s">
        <template>
          <h1 class="claim">I shut down my SaaS.</h1>
          <script>
            gamut.onReady("hook", () => {
              gsap.from(".claim", { scale: 1.4, opacity: 0, duration: 0.25, ease: "power4.out" });
              gsap.to(".claim",   { y: -40, opacity: 0, duration: 0.3, ease: "power2.in", delay: 1.5 });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="promise" start="2s" duration="3s">
        <template>
          <h2 class="line">Here's what I'd do instead.</h2>
          <script>
            gamut.onReady("promise", () => {
              gsap.from(".line", { y: 60, opacity: 0, duration: 0.45, ease: "back.out(1.8)" });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="caption" start="5s" duration="8s">
        <template>
          <p class="burned">Ship one workbook. Not a whole SaaS.</p>
          <script>
            gamut.onReady("caption", () => {
              gsap.from(".burned", { y: 30, opacity: 0, duration: 0.4, ease: "power3.out" });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="tag" start="13s" duration="2s">
        <template>
          <img class="logo" src="./assets/logo.svg" alt="">
          <p class="url">workbooks.sh</p>
          <script>
            gamut.onReady("tag", () => {
              gsap.from(".logo", { scale: 0.7, opacity: 0, duration: 0.4, ease: "back.out(1.6)" });
              gsap.from(".url",  { y: 20, opacity: 0, duration: 0.4, ease: "power3.out", delay: 0.2 });
            });
          </script>
        </template>
      </gm-scene>

    </gm-track>

  </gm-timeline>
</gm-doc>
```

**Anti-uses:** Don't use for product demos that need to show
nuance. Vertical + 15s eats all the room the demo needs.

---

## 5. Demo + screen recording

**For:** Product demos, feature launches, "let me show you" videos.
Screen recording is the centerpiece; voice or text overlay is
optional.

**Shape:** One base track slicing a long screen recording into
beat-sized chunks via `in`/`out`, one overlay track dropping
captions over the relevant moments.

**gamut HTML skeleton:**

```html
<gm-doc fps="30" resolution="1920x1080" aspect="16:9">

  <gm-asset id="recording" kind="video" src="./assets/demo.mp4"></gm-asset>
  <gm-asset id="vo"        kind="audio" src="./assets/demo-vo.mp3"></gm-asset>

  <gm-timeline id="main" duration="90s">

    <gm-track id="screen" z="0">
      <gm-clip asset="recording" start="0s"  in="0s"  out="10s"></gm-clip>
      <gm-clip asset="recording" start="10s" in="10s" out="40s"></gm-clip>
      <gm-clip asset="recording" start="40s" in="40s" out="60s"></gm-clip>
    </gm-track>

    <gm-track id="vo" z="0">
      <gm-audio asset="vo" start="0s" duration="80s" volume="0.9"></gm-audio>
    </gm-track>

    <gm-track id="captions" z="10">
      <gm-scene id="open" start="2s" duration="6s">
        <template>
          <p class="cap">Cold start, no setup.</p>
          <script>
            gamut.onReady("open", () => {
              gsap.from(".cap", { y: 30, opacity: 0, duration: 0.5, ease: "power3.out" });
              gsap.to(".cap",   { opacity: 0, duration: 0.4, ease: "power2.in", delay: 5.1 });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="action" start="14s" duration="20s">
        <template>
          <p class="cap">One click, three queries, live data.</p>
          <script>
            gamut.onReady("action", () => {
              gsap.from(".cap", { y: 30, opacity: 0, duration: 0.5, ease: "power3.out" });
              gsap.to(".cap",   { opacity: 0, duration: 0.4, ease: "power2.in", delay: 19.1 });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="recap" start="60s" duration="20s">
        <template>
          <h2 class="recap">Ship a workbook in an afternoon.</h2>
          <script>
            gamut.onReady("recap", () => {
              gsap.from(".recap", { y: 60, opacity: 0, duration: 0.8, ease: "back.out(1.6)" });
            });
          </script>
        </template>
      </gm-scene>

      <gm-scene id="tag" start="80s" duration="10s">
        <template>
          <p class="url">workbooks.sh</p>
          <script>
            gamut.onReady("tag", () => {
              gsap.from(".url", { letterSpacing: "0.5em", opacity: 0, duration: 0.9, ease: "power2.out" });
            });
          </script>
        </template>
      </gm-scene>
    </gm-track>

  </gm-timeline>
</gm-doc>
```

**Anti-uses:** Don't use as a hero brand asset — demos age
quickly as UI changes. Reserve for "what's new" releases where
the demo IS the news.
