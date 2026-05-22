# Picking `wasmVariant`

The `wasmVariant` field in `workbook.config.mjs` decides which runtime WASM build the compiled `.html` carries. Two practical choices.

## `wasmVariant: "none"` — ~150 KB

The compiled artifact carries no WASM at all. Use this whenever the workbook doesn't import the `wb.*` WASM APIs (Polars, Candle, SQLite, Rhai, ML).

```js
// workbook.config.mjs
export default {
  slug: "my-doc",
  type: "document",
  entry: "src/index.html",
  wasmVariant: "none",
};
```

Right for:
- documents (prose, no computation)
- presentations (slides, no computation)
- spas that talk to external APIs or do pure-JS work
- playgrounds — same reason as spas

The `presentation` and `playground` starter templates default to `"none"` already; verify before changing.

## Default variant — ~8 MB

Omit `wasmVariant` (or set it to the default) when the workbook actually imports `wb.*` from `@work.books/runtime`. That's notebooks running Polars/SQLite, spas doing Candle inference, anything that needs the bundled scientific stack.

## How to decide

Grep the source for `from "@work.books/runtime"` or `wb.polars` / `wb.candle` / `wb.sqlite` / `wb.rhai` / `wb.ml` style imports. No matches → `wasmVariant: "none"`. The size delta is roughly 50×; setting it wrong on a static spa wastes user bandwidth on every open.

## Why this matters

Workbooks are delivered as one `.html`. Every byte is paid by the recipient on open. An 8 MB document loads slower than a 150 KB one, regardless of whether the WASM is ever called. The default is conservative — opt out explicitly when you know you don't need it.

## Anti-patterns

- Setting `"none"` on a notebook that calls `wb.polars` — the runtime call will throw at use time. Test the build before publishing.
- Defaulting to the heavy variant "just in case." If the imports aren't there, neither is the need.
- Mixing variants across workbooks in a workgroup without checking — the workgroup share size is the sum of its workbooks.
