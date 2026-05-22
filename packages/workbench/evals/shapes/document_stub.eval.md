---
name: shapes/document-stub
agent: workhorse
timeoutMs: 1200000
turns:
  - prompt: |
      Make me a workbook for taking meeting notes. Use the slug
      "meeting-notes" exactly, place it at the substrate root, push the
      full tree, then reply DONE when the push succeeds.
    checks:
      # USE PAIRED — short sentinel paired with two substrate gates
      # below. The agent can't satisfy these by saying DONE without
      # actually scaffolding + pushing the tree.
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_exists
        path: meeting-notes/workbook.config.mjs
      # Anchor on `type: "document"` in the manifest — proves the agent
      # chose the document template (not a generic SPA). The string
      # "document" isn't named in the prompt, so this isn't a parrot
      # gate.
      - kind: substrate.file_contains
        path: meeting-notes/workbook.config.mjs
        substring: 'type: "document"'
      # Build + shape-inferred probe (h1, h2, article — see
      # DEFAULT_PROBE_BY_TYPE in src/eval/actions/workbook.mjs).
      # Hollow `<html></html>` artifacts fail here.
      - kind: workbook.build
        workbookPath: meeting-notes
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. Confirms a document-shape workbook was scaffolded (mentions
             the slug "meeting-notes", a directory, or "I created /
             scaffolded / built").
          2. Mentions at least one meeting-notes feature appropriate to a
             prose document — sections, headings, agenda, attendees,
             action items, decisions, summary, or similar.
          3. Did NOT push a SPA-style schema (forms, list views, status
             columns) as the primary structure.

          Fail if ANY of these are true:
          - The response is only a clarifying question, with no artifact
            produced.
          - The response is so terse it can't be verified ("done.",
            "built it.").
          - The workbook described has nothing to do with meeting notes
            (generic document with placeholder content).
          - The response refuses, says "I cannot", or proposes an
            alternative without doing the task.
          - Claims to have built it but the description names a
            type other than "document" (e.g. "I made a notebook" or
            "I made an SPA").
cleanup:
  - kind: substrate.remove_path
    path: meeting-notes
---

# shapes/document-stub

The minimum bar for the **document** template: a user asks for a
prose-shaped workbook (meeting notes) and the agent must (a) pick the
document type — not the default SPA — (b) scaffold a usable structure
of headings + sections, and (c) push the tree.

The prompt pins the slug so the substrate gates are predictable. The
real proofs are stacked:

- `substrate.file_exists` — manifest landed at the root (Workhorse
  places workbooks at `<slug>/`, not `workbooks/<slug>/`).
- `substrate.file_contains` on `type: "document"` — proves template
  selection, not a generic SPA.
- `workbook.build` — the artifact compiles and the shape-inferred
  probe (h1/h2/article) matches in the rendered HTML.
- `rubric.passes` — the response describes a document-shaped artifact
  with meeting-notes-shaped sections.

Fail-if criteria explicitly catch the "I built an SPA instead" and
"vague success message" anti-patterns flagged in EVAL_PRINCIPLES.md.
