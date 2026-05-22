---
name: shapes/presentation-stub
agent: workhorse
timeoutMs: 1200000
turns:
  - prompt: |
      Build a 5-slide deck on why htmx beats SPA frameworks. Use the
      slug "htmx-vs-spa" exactly, place it at the substrate root, push
      the full tree, then reply DONE when the push succeeds.
    checks:
      # USE PAIRED — DONE is the coordination marker; the substrate
      # gates and build probe carry the actual assertion.
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_exists
        path: htmx-vs-spa/workbook.config.mjs
      # Pin template choice — `type: "presentation"` is the falsifiable
      # anchor and is NOT the literal phrasing of the prompt.
      - kind: substrate.file_contains
        path: htmx-vs-spa/workbook.config.mjs
        substring: 'type: "presentation"'
      # Build + shape-inferred probe ([data-slide], section.slide,
      # .slide). An agent shipping a deck with zero slide markup fails
      # the probe even if it built. Default noConsoleErrors guards
      # against broken slide-runtime imports.
      - kind: workbook.build
        workbookPath: htmx-vs-spa
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. Confirms a presentation-shape workbook was scaffolded
             (mentions the slug "htmx-vs-spa", a directory, or "I
             created / scaffolded / built").
          2. Describes deck content addressing both sides: at least one
             concrete htmx advantage (server-rendering, hypermedia,
             smaller bundle, simpler ops, progressive enhancement, no
             client state machine, etc.) AND at least one SPA pain
             point being addressed.
          3. The deck is described as having approximately 5 slides
             (acceptable: 4-6). A 1-slide or 20-slide answer fails.

          Fail if ANY of these are true:
          - The response is only a clarifying question, with no
            artifact produced.
          - The response is so terse it can't be verified ("done.",
            "deck built.").
          - The workbook is described as a generic document or SPA
            rather than a slide deck.
          - The response refuses, says "I cannot", or proposes an
            alternative without doing the task.
          - Slide content is described as placeholder ("slide 1: title,
             slide 2: ...") with no real htmx-vs-SPA argument.
cleanup:
  - kind: substrate.remove_path
    path: htmx-vs-spa
---

# shapes/presentation-stub

Minimum bar for the **presentation** template plus a content-judgment
overlay. The user asks for a 5-slide deck with an opinionated angle;
the agent has to (a) pick `type: "presentation"`, (b) populate the
deck with substantive content (not placeholder slide titles), and
(c) push.

Stacked proofs:

- `substrate.file_exists` — manifest at the root.
- `substrate.file_contains` on `type: "presentation"` — pins the
  template; the manifest field is not phrased in the prompt.
- `workbook.build` — default probe asserts slide markers
  (`[data-slide], section.slide, .slide`) exist in the rendered HTML.
- `rubric.passes` — checks that the response describes both htmx
  advantages AND SPA pain points (not just one side), and that the
  deck length is sane (≈5 slides). Explicit Fail-ifs catch
  placeholder-content gaming and wrong-shape artifacts.

This is the first shape spec that asks the agent to make an
*argumentative* artifact, not a neutral tool — the rubric's
two-sided-argument requirement is the discriminator.
