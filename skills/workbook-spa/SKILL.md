---
name: Workbook (spa)
description: Build a portable single-file HTML workbook whose reader USES A STATIC INTERFACE — dashboards, tools, presentations with custom UI, games. Use when the user mentions a "single-page app", "dashboard", "tool", "presentation" with custom UI, or a "game"; or when the deliverable owns the full viewport with no host chrome AND has no agent loop. If the deliverable RESPONDS TO MESSAGES and writes outputs into a folder, use the workbook-agent skill — spa is for static interfaces only. For prose use the document skill; for re-runnable cells use the notebook skill.
---

# Workbook — `spa` shape

If the deliverable RESPONDS TO MESSAGES and writes outputs into a folder,
use the **workbook-agent** skill. `spa` is for static interfaces only.

An spa workbook is one `.html` file that owns the full viewport. No
host chrome, no cell run-buttons, no article layout — your code and
your CSS run the page. Use this for dashboards, tools, presentations
with custom UI, and games. The value is in the static *interface*, not
in a chat loop.

Pick this shape when the value is in the *interface*. Pick `agent` if
the value is the chat loop and the agent writes outputs into a folder.
Pick `document` if the value is prose. Pick `notebook` if the reader
re-runs cells.

## Hard rules (apply to every workbook shape)

1. One file output — exactly one `<slug>.html`. No siblings.
2. Plain `.html` extension. Identity is content-based, not filename.
3. Author with `@work.books/cli`.
4. Bare `.html` is canonical — runs in any browser, source bundled inside.
5. Persistent state belongs at workbooks.sh; the `.html` itself is stateless.
6. `workbooksd` is legacy.

## Quick-start

In this sandbox you scaffold with the `workbook_init` **tool** — it
materializes the same template the CLI's `workbook init --shape=spa`
ships. Don't try to shell out to `workbook` itself; just call the
tool:

```
workbook_init({
  slug: "my-app",
  name: "My App",
  shape: "spa",
  dest: "my-app"        // or "/workbooks/my-app", etc.
})
```

The tool writes: `my-app/workbook.config.mjs`, `my-app/index.html`,
`my-app/main.js`, `my-app/styles.css`, `my-app/package.json`.

The generated `workbook.config.mjs` has the canonical schema —
`type: "spa"` at the root, plus `name`, `slug`, `entry`. Edit
`main.js` and `index.html` to fill in your interface.

Outside this sandbox, a human author runs:

```bash
npm install -g @work.books/cli
workbook init my-app --shape=spa
cd my-app
workbook dev          # local watcher
workbook build        # → dist/my-app.html
```

Same template, same schema. The tool is a pure-Elixir port of `init`
so agent and human stay in sync.

Pick a framework template — Svelte, React, vanilla — based on what
you're building:

```bash
workbook init my-app --template html-workbook          # plain HTML/JS
workbook init my-app --template presentation-svelte    # Svelte presentation
```

The CLI inlines the framework runtime + workbook runtime + your code
into a single `.html`. Source-bundle ships inside; recipient runs
`workbook unbundle <file>` to recover a working dev tree.

## Common pitfalls

- **Don't reach for `spa` because you have one button.** A document
  with a "copy to clipboard" link is still a document. spa means the
  interface IS the deliverable.
- **Don't reach for `spa` because you want to embed a chat.** If the
  app loop is "user sends message → model responds → tool writes file",
  that's an `agent` workbook, not spa. spa has no agent loop, no
  systemPrompt, no `agent` block in `workbook.config.mjs`.
- **Single viewport, no scroll-jacking.** spa workbooks open in many
  contexts (iframes, hosted viewer, file://). Avoid `position: fixed`
  full-screen overlays that trap the user.
- **Heavy first-paint.** spa templates load framework runtimes;
  workbook build is fine but `workbook dev` cold start can take a few
  seconds. Use `workbook build --no-wasm` for dev iteration if you
  don't need the wasm runtime locally.

## References

| If you need to…                                       | Load                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| understand the on-disk file format                    | [_shared/references/format.md](../_shared/references/format.md) |
| run `workbook init / dev / build / unbundle / publish`| [_shared/references/cli.md](../_shared/references/cli.md)       |
| set env vars / publish to a group / MCP server        | [_shared/references/cli.md](../_shared/references/cli.md)       |
| call the runtime SDK from your spa code               | `packages/workbooks/packages/runtime/README.md` |

## Source of truth

- Repo: https://github.com/workbooks-sh/workbooks
- Examples: `examples/presentation-svelte`, `examples/html-workbook`
  (chat / agent examples belong under the `agent` shape — see the
  workbook-agent skill)
- CLI on npm: `@work.books/cli`
- Hosted viewer: https://workbooks.sh
