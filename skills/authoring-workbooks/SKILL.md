---
name: Authoring workbooks
description: When the user wants to make or modify a workbook, this skill teaches you how to scaffold a source folder, build it through the CLI, and publish a portable .html artifact.
---

# Authoring workbooks

A workbook is a folder of source files that compiles to one portable `.html`. The folder is canonical; the compiled `.html` is downstream. Always go through the CLI flow — the same commands a human author runs. Never hand-write a raw `.html` or scatter files outside a workbook folder.

## The canonical flow

You have three tools that mirror the CLI authoring flow — use them in this order:

1. `workbook_init({slug, name, shape, dest})` — scaffold the source folder. Same as `workbook init <slug> --template=<shape>` in a human's terminal.
2. Edit files under `dest/src/` (use `write` for individual files, or `workbook_init` for a new shape).
3. `workbook_build({path: dest})` — compile to `dest/dist/<slug>.html`. Same as `workbook build`. Returns stdout/stderr/exit_code + the artifact path. The runtime materializes your VFS subtree to a tempdir, runs the real CLI, and copies the produced dist/ back into your VFS so subsequent reads see it.
4. `workbook_publish({path: dest})` — upload via the broker. Same as `workbook publish dist/<slug>.html`. Returns the share URL + id. Authenticates via `WORKBOOKS_BEARER` from the host environment.

```
workbook_init({slug, name, shape, dest}) → scaffold
write({path, content})                    → fill in content
workbook_build({path: dest})              → compile to dist/
workbook_publish({path: dest})            → broker upload, returns share URL
```

`<shape>` is `document | spa | notebook | presentation | playground | agent`. The build CLI rejects shapes you don't have access to via `WORKBOOKS_ALLOWED_TEMPLATES`. `workbook_publish` surfaces the share URL — repeat it in your reply verbatim so the user can click it.

**Do NOT** try to run `workbook build` or `workbook publish` via the `bash` tool — the BEAM sandbox doesn't have node or the CLI installed. The `workbook_build` / `workbook_publish` tools spawn the real CLI on the host with the materialized VFS, which is the only path that works.

After writing content you want the user to watch form, call `open_stage({filepath: "<slug>/<entry>"})` once. The right pane animates in and auto-refreshes on every write or edit to that path. Call this AFTER content exists. Paths are relative to your VFS root (which is the substrate root).

## When to publish vs render inline

- Render inline (`render({block:{...}})`) when the user will read the output once — chat answers, callouts, ad-hoc tables.
- Publish a workbook when the output is something the user would want to keep, share, embed, or interact with — specs, mockups, dashboards, code-review writeups, custom editors.

Workbooks are portable HTML mini-apps: one file, source bundled inside. Recipients email or host them anywhere, or run `workbook unbundle` to recover the source.

## Choosing a shape

Five shapes, distinguished by what the READER does:

- `document` — reads prose top-to-bottom. Briefs, scripts, writeups.
- `notebook` — re-runs cells, drives computation. Data analysis.
- `spa` — uses a custom interface. Dashboards, tools, custom editors.
- `presentation` — steps through slides with presenter mode.
- `agent` — RESPONDS TO MESSAGES inside Studio's chat surface. Default for any deliverable where the value is the agent loop. See `references/agent-shape.md` — this shape has its own manifest contract.

"Playground" is not a shape — it's an `spa` pattern that mounts a stage primitive alongside an embedded agent. Use the `playground` starter template for an interactive spa with both stage and agent inside.

When designing "an AI thing" that responds to messages and produces artifacts, default to `agent`. Use `spa` only for static interfaces.

## Inline UI via `render`

The `render` tool shows interactive widgets inline — preferable to dumping data as plain text. See `references/render-blocks.md` for the block catalog and the markdown-vs-plain contract.

## Bundle size

For workbooks that don't import `wb.*` WASM APIs — most documents, presentations, spas — set `wasmVariant: "none"` in `workbook.config.mjs`. Artifact size drops from ~8 MB to ~150 KB. See `references/wasm-variants.md`.

## References

- `references/render-blocks.md` — `render` block catalog, markdown-vs-plain contract.
- `references/wasm-variants.md` — `wasmVariant` guidance for `workbook.config.mjs`.
- `references/agent-shape.md` — `type:"agent"` manifest, SKILL.md-as-file template for `manifest.skills`, anti-patterns.
