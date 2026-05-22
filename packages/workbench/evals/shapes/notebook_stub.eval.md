---
name: shapes/notebook-stub
agent: workhorse
timeoutMs: 1200000
turns:
  - prompt: |
      Make me a notebook for exploring a CSV. Use the slug "csv-explorer"
      exactly, place it at the substrate root, push the full tree, then
      reply DONE when the push succeeds.
    checks:
      # USE PAIRED — DONE is only a coordination marker; the real proof
      # is the substrate-side gates and the build probe below.
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_exists
        path: csv-explorer/workbook.config.mjs
      # Pin template choice. The string "notebook" appears in the
      # prompt as a noun, so we anchor on the YAML-shaped manifest
      # field instead — `type: "notebook"` is not the literal asked
      # for in the prompt.
      - kind: substrate.file_contains
        path: csv-explorer/workbook.config.mjs
        substring: 'type: "notebook"'
      # Build + shape-inferred probe (wb-cell, [data-cell], .wb-cell —
      # see DEFAULT_PROBE_BY_TYPE). An agent shipping a hollow
      # notebook with no runnable cell markup fails here.
      - kind: workbook.build
        workbookPath: csv-explorer
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. Confirms a notebook-shape workbook was scaffolded (mentions
             the slug "csv-explorer", a directory, or "I created /
             scaffolded / built").
          2. Mentions at least one CSV-exploration feature: parsing,
             loading, filtering, columns, rows, summary stats, charts,
             previewing, or similar.
          3. References runnable cells, code blocks, or step-by-step
             cell evaluation — the notebook idiom, not a static page.

          Fail if ANY of these are true:
          - The response is only a clarifying question with no artifact
            produced.
          - The response is so terse it can't be verified ("done.",
            "scaffolded it.").
          - The workbook described is a static document or a plain SPA
            with no notion of cells.
          - The response refuses, says "I cannot", or proposes an
            alternative without doing the task.
          - Claims to have built a notebook but the description names
            a different type (e.g. "I made a document" or "I made an
            SPA dashboard").
cleanup:
  - kind: substrate.remove_path
    path: csv-explorer
---

# shapes/notebook-stub

Minimum bar for the **notebook** template: the user asks for a
CSV-exploration tool — the natural shape is runnable cells (load CSV,
parse, summarize, chart). The agent must pick `type: "notebook"`,
populate it with cell-shaped content, and push.

Gates are stacked:

- `substrate.file_exists` — manifest landed at root (Workhorse places
  workbooks at `<slug>/`, not `workbooks/<slug>/`).
- `substrate.file_contains` on `type: "notebook"` — pins the
  template choice. Notebook is mentioned in the prompt as a common
  noun; the YAML shape `type: "notebook"` is the falsifiable anchor.
- `workbook.build` — default probe asserts `wb-cell, [data-cell],
  .wb-cell` is present in the rendered artifact. Hollow notebooks
  fail.
- `rubric.passes` — explicit Fail-if for "described as a doc/SPA",
  "vague success messages", and "asks clarifying questions only".

If the build probe fails but the rubric passes, the agent talked
about cells without rendering any.
