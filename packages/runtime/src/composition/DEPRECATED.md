# DEPRECATED — superseded by `packages/gamut/runtime/`

The Svelte-based composition runtime in this directory
(`Composition.svelte`, `Theater.svelte`, `ClipVideo.svelte`,
`gsapRunner.ts`, `transitions.ts`, `captions.ts`, `audioMixer.ts`)
was built against the legacy CW XML format and its enum-driven
recipe library. It's frozen.

**Two canonical replacements depending on render target:**

- Browser / live preview: `packages/gamut/runtime/` (TS). Registers
  the `<gm-*>` Web Components family, renders directly into the
  live DOM.
- Offline / video output: `packages/gamut/` (Rust). JSON
  composition spec → MP4 via Blitz + Animato + Vello + rsmpeg.
  CLI: `gamut render`, `gamut verify`. Same scene
  HTML format as the live runtime; no Chromium needed.

Both share the principle that the agent writes every motion
explicitly; missing fields surface as lint / verify errors, not
recipe-driven defaults.

`audioMixer.ts` was already clean (no recipes — author-supplied
gain envelopes) and has been ported to the new runtime as-is. The
other files were intentionally not ported: their recipe semantics
are the thing being replaced.

For the rationale, see the plan at
`~/.claude/plans/composed-fluttering-lovelace.md` and the gamut
package README at `packages/gamut/README.md`.
