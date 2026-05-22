---
name: Workbook (document)
description: Build a portable single-file HTML workbook whose reader READS prose top-to-bottom — reports, memos, narratives, longform writeups, presentations. Use when the user asks for a "document workbook", a "report", a "memo", a "writeup", "longform", a "presentation"; or when the deliverable is text + figures the reader consumes linearly without interaction. For re-runnable cells use the notebook skill; for interactive UI use the spa skill.
---

# Workbook — `document` shape

A document workbook is one `.html` file the reader scrolls through like
an article. Minimal chrome, no run-buttons, no interactive panels by
default. The artifact ships its own WASM runtime so embedded figures
(charts from Polars/SQLite, ML-rendered images) still compute live —
but the *reader* doesn't drive any computation, they just read.

Pick this shape when the value is the prose. Pick `notebook` if the
reader should re-run cells. Pick `spa` if the reader should use an
interface.

## Hard rules (apply to every workbook shape)

1. One file output — exactly one `<slug>.html`. No siblings.
2. Plain `.html` extension. Identity is content-based (`<meta name="wb-permissions">`, `<script id="wb-meta">`), not filename.
3. Author with `@work.books/cli`. Don't roll your own bundler.
4. Bare `.html` is canonical — runs in any browser, source bundled inside (recover via `workbook unbundle`).
5. Persistent state belongs at workbooks.sh. The `.html` itself is stateless — perfect for one-shot deliverables.
6. `workbooksd` is legacy; don't propose new daemon work without flagging the pivot.

## Quick-start

Scaffold with the `workbook_init` tool — same template the CLI ships:

```
workbook_init({
  slug: "my-report",
  name: "My Report",
  shape: "document",
  dest: "my-report"
})
```

This writes `my-report/workbook.config.mjs` (with the canonical
`type: "document"` schema at root), `index.html`, `main.js`, and
`styles.css`. Edit `index.html` to fill in your prose + `<wb-doc>`
sections.

A human author outside this sandbox uses:

```bash
npm install -g @work.books/cli
workbook init my-report --shape=document
workbook dev      # live-reload
workbook build    # → dist/my-report.html
```

In `src/index.html` use `<wb-doc>` for any persistent rich-text section
(reader edits survive Cmd+S round-trip), plain `<wb-cell language="chart">`
or `<wb-cell language="sql">` for figures, and ordinary prose for
everything else.

## Pairing a document with an agent

If the reader needs an assistant alongside the document — "answer
questions about this memo", "cite source paragraphs", "rewrite this
section" — that's a separate **`type:'agent'` workbook** the user
opens beside the document, not an inline embed.

The canonical pattern:

1. **Author the document** as a normal `type:'document'` workbook
   (prose, embedded figures, what the reader reads top-to-bottom).
2. **Author an agent workbook** (`workbook init memo-assistant --template=agent`)
   that takes the document as `context_folder_ids` in its
   `agent_group_shares` row. The agent reads the document via its
   FS-read tools.
3. **Group them**: publish both into the same Studio group. The
   reader opens the document in the viewer pane and the assistant
   in `/chat?agent=memo-assistant` — Studio renders them side by
   side.

This replaces the legacy `<wb-agent>` custom-element pattern that
embedded an agent directly into document HTML. The legacy element
predated `type:'agent'` and conflated two shapes (the document IS
the workbook; the agent is a separate workbook). For new authoring,
use the workbook-agent skill (`packages/workbooks/skills/workbook-agent/SKILL.md`)
to scaffold the assistant separately.

See `packages/workbooks/examples/document-mdx/` for a document with
embedded charts. For agent authoring, scaffold via `workbook init
--template=agent`.

## Common pitfalls

- **Don't reach for `notebook` because you have one chart.** A document
  with figures is still a document. Notebook means the reader is
  expected to re-run cells.
- **Don't paginate.** Documents are scrolls, not slides. For slides
  use a presentation template under `spa` (see `examples/presentation-svelte/`).
- **Print stylesheet matters.** Many readers print or PDF-export
  documents — include a `@media print` block.

## References

Load only what the current task needs. None of these auto-attach.

| If you need to…                                       | Load                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| understand the on-disk file format                    | [_shared/references/format.md](../_shared/references/format.md) |
| run `workbook init / dev / build / unbundle / publish`| [_shared/references/cli.md](../_shared/references/cli.md)       |
| call the browser-side runtime SDK                     | `packages/workbooks/packages/runtime/README.md` |

## Source of truth

- Repo: https://github.com/workbooks-sh/workbooks
- CLI on npm: `@work.books/cli`
- Hosted viewer: https://workbooks.sh
