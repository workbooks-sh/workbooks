---
name: substrate/workbook-tree-lands
agent: workhorse
timeoutMs: 1200000
turns:
  - prompt: "Scaffold a new workbook at workbooks/eval-fixture-tree using the spa template. Commit and push the full tree. Reply DONE when the push succeeds."
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_exists
        path: workbooks/eval-fixture-tree/workbook.config.mjs
      - kind: substrate.tree_at
        path: workbooks/eval-fixture-tree
        recursive: true
        # Canonical files from `workbook init --template=spa`. Some
        # may be omitted by the agent (e.g. .gitignore, styles.css if
        # the design is minimal); flagged here as expected so the
        # check actually verifies a workbook-shaped tree, not just
        # "any non-empty directory".
        expect:
          - workbook.config.mjs
          - index.html
          - main.js
      # wb-xpgr.4.4 — pair the tree check with a build+probe so an
      # agent can't pass by pushing a hollow `<html></html>`. Explicit
      # probe matches the spa shape declared in the template.
      - kind: workbook.build
        workbookPath: workbooks/eval-fixture-tree
        probe:
          domSelectors:
            - 'script[type="module"]'
          noConsoleErrors: true
cleanup:
  - kind: substrate.remove_path
    path: workbooks/eval-fixture-tree
---

# substrate/workbook-tree-lands

A whole-workbook write: the agent scaffolds a multi-file directory
tree (config + src + entry HTML at minimum) and pushes everything in
one go. The substrate.tree_at check (with no `expect:` list) just
asserts the directory is non-empty; expand it to an explicit manifest
once the template settles.
