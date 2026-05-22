# Visual design rules for video

Different from print and slides. Motion has its own constraints.

> For specific color palettes and named visual styles, defer to the
> upstream HyperFrames skill at
> `~/.claude/skills/hyperframes/visual-styles.md` and the project
> DESIGN.md. This page is the design-system *discipline* — the
> rules to apply ON TOP OF whatever palette you've picked.

## Typography for motion

1. **No thin weights.** Anything below 500 strobes when scaled +
   anti-aliased + tweened. Body type at 500–600, display at
   700–900. If the brand wants a 300-weight Inter, push back —
   it'll look broken in motion.
2. **Set type at the canvas size, not at viewer size.** Author at
   1920×1080. A 48px font ON the canvas reads as 48px after
   transform-scale; don't think in viewport pixels.
3. **Display sizes start at 72px.** Lower-third captions at 36–48px.
   Body at 28–32px. Anything smaller becomes unreadable on phones.
4. **One display + one body font.** A third font is a bug.
5. **Don't auto-kern.** Use `font-feature-settings: "kern" 1;` and
   verify visually. The browser's default kerning fails on display
   sizes.

## Color contrast on motion backgrounds

1. **WCAG AAA for any text that holds more than 1 second.** Motion
   backgrounds drift; text that's AA-compliant against the first
   frame can fail by frame 30.
2. **No body text directly on imagery.** Use a lower-third bar
   (rgba black, 60–80% opacity) or a card behind the text. Watch
   the brand-film mistake of "let's just put white type on the
   video" — readability dies in any bright frame.
3. **Drop shadows are not contrast.** A `text-shadow: 0 2px 4px
   rgba(0,0,0,0.5)` helps the eye find the edge of letters; it
   doesn't pass contrast. Layer a tint behind if you need it to
   pass.

## Lower-thirds + caption discipline

1. **Lower-thirds live in the bottom 25%.** Title-safe inside the
   bottom 12–15%.
2. **One lower-third on screen at a time.** Stacked lower-thirds
   read as a list, not a graphic.
3. **Caption length cap: 42 characters per line, 2 lines max.**
   Anything longer breaks the viewer's reading rhythm. If you need
   more words, cut to a new caption.
4. **Captions hold for ≥ 1.2 seconds.** Faster and the eye doesn't
   complete the read. The HF caption "word-highlight" mode handles
   this automatically; manual layers need to budget for it.
5. **Always burn captions, even when you ship a `.srt`.** Burned
   captions survive mute autoplay; SRT only fires on enabled
   tracks.

## Motion discipline

1. **Entrances under 0.6s. Exits under 0.4s.** Anything slower
   reads as draggy.
2. **Stagger by 0.1–0.15s.** Tighter and the elements look
   simultaneous; wider and they look disconnected.
3. **One easing per composition.** Mixing `power3.out` and
   `expo.inOut` reads as visual noise.
4. **No more than 3 simultaneous motion vectors.** A title sliding
   in, a logo scaling, a background blooming — that's the cap.
   Add a fourth and the eye gives up.
5. **Decay matters.** Don't park elements at full opacity / full
   scale and forget them. Slight breathing (`autoAlpha: 0.95`,
   slow `y: ±2px`) keeps the frame alive without distracting.

## Anti-patterns

- **Fade-in everything.** Default fade-in reads as "I didn't think
  about this." Use direction. Title rises, logo scales, image
  reveals from a mask.
- **Stock easing.** `power2.inOut` is the safe-but-boring default;
  most compositions read better with `expo.out` for entrances and
  `power2.in` for exits.
- **Loop without intent.** A 30-second background-pattern loop
  that's noticeably looping reads as cheap. Either loop the whole
  composition (`gsap.timeline({ repeat: -1 })`) or hide the loop
  point with a transition.
- **Black at the head and tail.** Don't start on a black frame —
  the autoplay shows a black thumbnail. Start on the first key
  visual; let the platform's "starting…" UI cover the load.
- **Centered everything.** Compose to thirds; reserve center for
  the manifesto-style hold frame.
- **Forgetting the safe area.** Title-safe is 10% in from every
  edge. Anything inside that gets clipped on some devices /
  social-platform UIs.

## Asset rules

1. **Video clips: 1080p H.264 or VP9.** Larger codecs blow the
   `.html` size. The CW XML knows about ProRes / DNxHR for the
   eventual render pipeline; the browser player wants web-native
   codecs.
2. **Images: WebP or AVIF.** PNG/JPEG only when nothing else is
   available; the workbook artifact is sensitive to size.
3. **Fonts: woff2.** Subset to the glyphs the composition uses if
   the font is over 50 KB.
4. **Audio: AAC or Opus.** Single track, ducked under VO if a
   voiceover is present.
