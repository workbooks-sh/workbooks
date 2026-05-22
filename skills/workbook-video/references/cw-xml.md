# cw-xml — DEPRECATED

This page documented the legacy CW XML composition format
(separate `.xml` schedule file + scene `.html` files; recipe-driven
`<animation intent="reveal">` / `<transition kind="fade">` /
`<caption mode="word-highlight">` enums; `<Theater>` + `<Composition>`
Svelte wrappers).

**It's been replaced by the gamut HTML format.** Same author goal
(portable `.html` video composition), cleaner shape (single file
with `<gm-*>` custom elements, no recipe library, animation lives
in the scene's HTML/JS).

→ **See [gamut.md](./gamut.md) for the canonical format reference.**

The legacy `@work.books/cw-xml` package and the
`packages/workbooks/packages/runtime/src/composition/` Svelte
components are frozen — they remain on disk for any external
consumers mid-migration but receive no new features or bug fixes.
See `packages/workbooks/packages/cw-xml/DEPRECATED.md`.
