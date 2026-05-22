# @workbook/runtime

Svelte 5 UI runtime for workbooks — the components that render the workbook block tree. Used in two contexts:

1. **Live mode**: imported as a workspace package, mounted inside a host app
2. **Exported mode** (.workbook files): bundled to a CDN-deployable ESM module that the exported HTML imports at `<your-cdn>/@workbook/runtime/v1.js`

Both contexts use the **same components** — there is no separate static-render path. See [`docs/SPEC.md`](../../docs/SPEC.md) > Rendering & Components.

## What's in here

| File | Purpose |
|---|---|
| `src/Workbook.svelte` | Root component — reads manifest, walks block tree |
| `src/WorkbookBlock.svelte` | Block dispatcher — maps each block kind to its component |
| `src/workbookContext.ts` | Context store for data references (block lookup, citations) |
| `src/blocks/*.svelte` | One Svelte component per block kind |

## Build

```bash
bun run build         # produces dist/workbook-runtime.js
bun run typecheck     # svelte-check
```

## Migration status

This package is being filled incrementally. Today's contents:

- ✅ Display blocks (no runtime data fetching): Heading, Paragraph, Markdown, Callout, Divider, Code, Diagram, Chart, Metric, Metrics, Table, Concept, Step, Machine, Widget, Network, Geo, Embedding3D
- ✅ Root: Workbook.svelte, WorkbookBlock.svelte, workbookContext.ts
- ⏸️ Convex-coupled blocks (need peer-dep decoupling first): File, Image, Video, Input
- ⏸️ App-specific UI: ArtifactChip, PlanWidget, WorkbookToolbar, CitationReport (stay in apps/web)

## One workbook, one iframe

A workbook is **one** trust boundary: one bundled `.html`, rendered as one iframe by the host. WASM, components, and any author code all run inside that single iframe and inherit its sandbox. The build pipeline must never emit a nested `<iframe>` for an internal component — components are just code in the bundle.

Authors may include their own `<iframe>` tags to embed third-party content (a YouTube player, a Stripe form). Those are author-chosen embeds; the host's sandbox attributes still apply to the outer iframe that contains them. What is **not** allowed: the build pipeline injecting an iframe to wrap an internal component, runtime block, or compiled fragment. That would create a nested trust boundary the host can't reason about.

The CLI enforces this at build time by counting literal `<iframe` occurrences in the source tree vs the compiled HTML and failing the build if the compiled count exceeds the source count. See `packages/workbook-cli/src/checks/iframeInvariant.mjs`.

For the full security model (cross-origin sandbox, CSP, signed provenance, 3-layer agent-output validation) see `CLAUDE.md` > "Workbook security model".

## Reference

- `docs/WORKBOOK_SPEC.md` — format spec, block catalog, rendering architecture
- `docs/WORKBOOK_REFACTOR.md` — phase plan; this package is P1.2
