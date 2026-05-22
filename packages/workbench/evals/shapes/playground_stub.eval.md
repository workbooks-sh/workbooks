---
name: shapes/playground-stub
agent: workhorse
timeoutMs: 1200000
turns:
  - prompt: |
      Make me a playground for messing with an HTML canvas. Use the
      slug "canvas-playground" exactly, place it at the substrate root,
      push the full tree, then reply DONE when the push succeeds.
    checks:
      # USE PAIRED — DONE is paired with the substrate gates and build
      # probe below. Sentinel alone is gameable.
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_exists
        path: canvas-playground/workbook.config.mjs
      # Playground idiom = type:"spa" with a `stage` block (the legacy
      # type:"playground" still parses but new scaffolds use the spa
      # form — see packages/workbooks/packages/workbook-cli/src/util/config.mjs).
      # The `stage:` key is the falsifiable anchor: an SPA without it
      # is not a playground.
      - kind: substrate.file_contains
        path: canvas-playground/workbook.config.mjs
        substring: "stage:"
      # Build + shape-inferred probe (script[type="module"] — spa
      # default). Combined with the stage: substring above this is
      # the "spa + stage probes" pair called for in the wb-ojss.1
      # spec list.
      - kind: workbook.build
        workbookPath: canvas-playground
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. Confirms a playground-shape workbook was scaffolded
             (mentions the slug "canvas-playground", a directory, or
             "I created / scaffolded / built").
          2. Mentions canvas-specific affordances: drawing, shapes,
             pixel manipulation, brushes, an interactive stage, or
             at least one HTML5-canvas API surface (2d context,
             requestAnimationFrame, mouse/pointer events).
          3. Describes the artifact as interactive — sliders, buttons,
             controls, or live-edit cells — not a static page.

          Fail if ANY of these are true:
          - The response is only a clarifying question with no artifact
            produced.
          - The response is so terse it can't be verified ("done.",
            "playground built.").
          - The workbook described has nothing to do with canvas
            (e.g. a generic todo list or markdown editor).
          - The response refuses, says "I cannot", or proposes an
            alternative without doing the task.
          - The workbook is described as a slide deck, document, or
            notebook rather than an interactive SPA-shaped sandbox.
cleanup:
  - kind: substrate.remove_path
    path: canvas-playground
---

# shapes/playground-stub

Minimum bar for the **playground** idiom. Playground is a pattern, not
a top-level `type:` value — the manifest is `type: "spa"` with a
`stage` block. This spec verifies the agent recognizes the idiom (not
just "I'll make a generic SPA") and produces a canvas-flavored
interactive sandbox.

Stacked proofs:

- `substrate.file_exists` — manifest at the root.
- `substrate.file_contains` on `stage:` — pins the playground idiom.
  A bare SPA without a stage block is not a playground; this gate
  fails for that case.
- `workbook.build` — default probe asserts `<script type="module">`
  (spa marker) is present. Paired with the stage: substring above,
  this is the "spa + stage" double-anchor required by wb-ojss.1.
- `rubric.passes` — explicit Fail-if for "no canvas mentioned",
  "static artifact", "wrong shape (deck/document/notebook)", and
  the standard vague-success gaming patterns.

If the build probe passes but the substring gate fails, the agent
made a generic SPA without registering "playground" as a distinct
pattern — exactly the regression this shape coverage is here to
catch.
