---
name: Workbook (notebook)
description: Build a portable single-file HTML workbook whose reader RE-RUNS CELLS — data analysis, ML scratchpads, SQL exploration, parameter sweeps, anything where the reader changes inputs and re-evaluates. Use when the user mentions a "notebook", "Jupyter-like", "cells", "data analysis", "scratchpad", "re-runnable", or asks to build something where the reader drives computation. For static prose use the document skill; for free-form interactive UI use the spa skill.
---

# Workbook — `notebook` shape

A notebook workbook is one `.html` file made of `<wb-cell>` elements
the reader can edit, re-run, and chain. Each cell holds Rhai, SQL, a
chart spec, or a JavaScript expression; outputs flow into downstream
cells via the reactive DAG. The runtime is inlined, so the reader can
crunch real data (Polars, DuckDB-WASM, SQLite, Candle) without
installing anything.

Pick this shape when the value is in *running* the cells. Pick
`document` if cells exist only as embedded figures. Pick `spa` if you
need full-viewport UI without the cell metaphor.

## Hard rules (apply to every workbook shape)

1. One file output — exactly one `<slug>.html`. No siblings.
2. Plain `.html` extension. Identity is content-based, not filename.
3. Author with `@work.books/cli`.
4. Bare `.html` is canonical — runs in any browser, source bundled inside.
5. Persistent state belongs at workbooks.sh; the `.html` itself is stateless.
6. `workbooksd` is legacy.

## Quick-start

Scaffold with the `workbook_init` tool — same template the CLI ships:

```
workbook_init({
  slug: "my-analysis",
  name: "My Analysis",
  shape: "notebook",
  dest: "my-analysis"
})
```

This writes the canonical notebook template
(`type: "notebook"` at root, `<wb-cell>` markup in `index.html`).
Add or edit cells in `index.html` to build out your runnable
notebook.

A human author outside this sandbox uses:

```bash
npm install -g @work.books/cli
workbook init my-analysis --shape=notebook
workbook dev
workbook build    # → dist/my-analysis.html
```

Typical cell wiring:

```html
<wb-cell id="src" language="sql">
  SELECT * FROM read_csv('data/sales.csv')
</wb-cell>

<wb-cell id="agg" language="sql" depends="src">
  SELECT region, SUM(amount) AS total FROM src GROUP BY region
</wb-cell>

<wb-cell id="chart" language="chart" depends="agg">
  { "mark": "bar", "encoding": { "x": "region", "y": "total" } }
</wb-cell>
```

Cells with `depends=` re-run automatically when upstream changes. Output
shapes (Arrow tables, JSON, images) round-trip through `<wb-memory>` on
Cmd+S so the reader's edits survive saves.

## Pairing a notebook with an agent

If the analyst wants an assistant alongside the notebook — "write SQL
cells for me", "explain this output", "find anomalies in the
results" — that's a **separate `type:'agent'` workbook**, not an
inline embed.

Canonical pattern (matches the document skill):

1. **Author the notebook** as a normal `type:'notebook'` workbook
   (cells, outputs, what the reader re-runs).
2. **Author an agent workbook** that takes the notebook's outputs as
   `context_folder_ids` in its `agent_group_shares` row.
3. **Group them**: publish both into the same Studio group. The
   reader opens the notebook in the viewer and the assistant in
   `/chat?agent=<slug>`. Studio renders them together.

The agent can emit new cell content via `render({ block: { kind:
"code", lang: "sql", code: "…" } })` — the reader pastes into the
notebook, runs, iterates.

This replaces the legacy `<wb-cell language="agent">` and `<wb-agent>`
custom-element patterns that embedded agents directly into notebook
HTML. Those predated `type:'agent'` and conflated two shapes. For new
authoring, use the workbook-agent skill to scaffold the assistant
separately.

See `packages/workbooks/examples/csv-explore/` for a non-agent notebook
to copy as a starter.

## Common pitfalls

- **Don't smuggle interactive UI into cells.** If you need
  drag-and-drop, multi-step forms, or anything that's not "edit input →
  re-run", switch to `spa`.
- **Cell ids are stable refs.** Renaming `id="src"` breaks every
  `depends="src"` cell. Treat ids like function names.
- **Outputs persist via `<wb-memory>`, not localStorage.** Anything you
  want round-tripped on Cmd+S has to live in a cell output or a
  declared `<wb-memory>` slot.

## References

| If you need to…                                       | Load                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| understand `<wb-cell>` / `<wb-memory>` formats        | [_shared/references/format.md](../_shared/references/format.md) |
| run `workbook init / dev / build / unbundle / publish`| [_shared/references/cli.md](../_shared/references/cli.md)       |
| call the runtime SDK (Polars, SQLite, ML) from cells  | `packages/workbooks/packages/runtime/README.md` |

## Source of truth

- Repo: https://github.com/workbooks-sh/workbooks
- Examples: `examples/csv-explore`, `examples/notebook-agent`, `examples/notebook-mdx`
- CLI on npm: `@work.books/cli`
- Hosted viewer: https://workbooks.sh
