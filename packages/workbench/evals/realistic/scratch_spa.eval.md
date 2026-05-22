---
name: realistic/scratch-spa
agent: workhorse
timeoutMs: 1200000
turns:
  - prompt: "make me a workbook for tracking my reading list"
    checks:
      - kind: substrate.file_exists
        path: reading-list/workbook.config.mjs
      - kind: workbook.build
        workbookPath: reading-list
        probe:
          domSelectors:
            - 'script[type="module"]'
          noConsoleErrors: true
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. Confirms a workbook was created (mentions a slug, directory, or "I built /
             scaffolded / created").
          2. Mentions at least one reading-list feature: adding books, marking as read,
             list/table view, search, sorting, status — anything a reading-list UI has.
          3. Did NOT only ask clarifying questions before building.

          Fail if ANY of these are true:
          - The response is only a question / asks for more info before producing anything.
          - The workbook described has nothing to do with reading lists (e.g. a generic
             "todo app" with no book-shaped fields).
          - The response refuses, says "I cannot", or proposes an alternative without
             actually doing the task.
          - The response is so terse it's not verifiable (just "done." or "built it.").
cleanup:
  - kind: substrate.remove_path
    path: reading-list
---

# realistic/scratch-spa

The minimum bar: a user types one short sentence describing what they want,
and a workbook materializes. No filename, no template selection, no schema
hints. The agent has to:
- pick a slug
- pick a template (spa is the natural choice)
- decide on a schema (books, dates, status)
- produce a usable UI
- push the tree

`workbook.build` proves the artifact compiles. `rubric.passes` proves it's
actually a reading-list workbook and not just an empty SPA template.

If `workbook build` requires the slug to match the directory, the cleanup
path may miss (the agent could have picked a different slug). That's
acceptable — operator can `git rm` stray fixtures.
