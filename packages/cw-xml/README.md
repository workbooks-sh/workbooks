# @work.books/cw-xml

Renderer-neutral TypeScript port of the **cw-xml** video composition
spec. Mirrors the canonical Rust crate at
`colorwave/packages/gamut/crates/cw-xml/` and is intended to stay in
lockstep with it.

Workspace-only — not published to npm. Used by `@work.books/runtime`
to power the in-browser `<Theater>` + `<Composition>` player.

## Status — drift risk

CW XML is **v0.1**. The Rust crate is the source of truth; this port
mirrors `ir.rs`, `time.rs`, and `timeline.rs`. When the spec changes
upstream, expect to update this package in the same PR.

The browser-side `DOMParser` is used in place of `roxmltree`. Validation
is intentionally lighter than the Rust `validate.rs` (we surface errors
but don't replicate every diagnostic exactly).

## What's parsed

- All top-level attrs (`version`, `fps`, `resolution`, `aspect`)
- `<assets>` / `<asset>`
- `<analysis>` / child kinds (transcript/faces/ocr/saliency/…)
- `<exports>` / `<export>`
- `<sequence>` / `<scene>` / `<shot>` recursive nesting
- `<clip>` with `start` / `duration` / `in` / `out` / `sync`
- `<layer>` with `<text>` content
- `<caption>`, `<constraint>`, `<animation>`
- `<transition-in>` / `<transition-out>`

## Time strings

`parse_time` accepts:

- `"24f"` — absolute frames
- `"5s"`, `"1.5s"` — seconds (must resolve to whole frames at the
  given fps; the Rust crate rejects sub-frame precision and so do we)
- `"00:04:12:08"` — SMPTE timecode `HH:MM:SS:FF`

## Layout

- `src/types.ts` — IR types
- `src/time.ts` — frame / seconds / SMPTE resolver
- `src/parser.ts` — DOMParser → IR
- `src/timeline.ts` — IR → `ResolvedTimeline` (absolute frames)
- `src/index.ts` — barrel
