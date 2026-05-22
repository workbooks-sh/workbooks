# DEPRECATED — superseded by `@work.books/gamut-runtime`

This package (`@work.books/cw-xml`) is the legacy CW XML parser /
resolver / linter for the colorwave-derived format. It baked in
enum-driven templates that substituted behavior for missing fields:
`intent="reveal"` selected a tween recipe, `kind="fade"` selected a
transition, `mode="word-highlight"` selected a caption renderer.
That model proved wrong — the runtime invented motion the agent
never authored.

**Two canonical replacements depending on render target:**

- Browser / live preview: `@work.books/gamut-runtime` (TS, in
  `packages/gamut/runtime/`). Same parser / timeline / lint API as
  the v1 cw-xml but for the gamut HTML format, no recipes.
- Offline / video output: `gamut` (Rust, in
  `packages/gamut/`). JSON composition spec → MP4 via
  Blitz + Animato + Vello + rsmpeg. CLI: `gamut render`,
  `gamut verify`. Renders the same composition headlessly
  with no Chromium dependency.

Both share the principle that the agent writes the full motion every
time; missing fields are linter errors, not recipe-driven defaults.

The replacement lives at `packages/gamut/runtime/` in this monorepo
and is the source of truth going forward. Both packages may coexist
for one or two release cycles to let any external consumers
migrate; this package is frozen — no new features or bug fixes.

For the rationale, see the plan at
`~/.claude/plans/composed-fluttering-lovelace.md` and the gamut
package README at `packages/gamut/README.md`.
