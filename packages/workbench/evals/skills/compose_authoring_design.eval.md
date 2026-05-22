---
name: skills/compose-authoring-design
agent: workhorse
timeoutMs: 1500000
questions:
  - id: q-skills-composition
    bears_on: directly
  - id: q-skills-resolution
    bears_on: partially
turns:
  - prompt: |
      Build me a one-page landing page workbook for a small business
      called "Ridge Trail Coffee Co." — a craft coffee roaster in
      Boulder, Colorado. Make it visually distinctive: not a generic
      Tailwind-card layout. Use the slug "ridge-trail" and place it
      at the substrate root, then push the tree. Reply DONE when the
      push succeeds.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_exists
        path: ridge-trail/workbook.config.mjs
      # SPA shape from workbook-spa skill
      - kind: substrate.file_contains
        path: ridge-trail/workbook.config.mjs
        substring: 'type: "spa"'
      # Builds + shape-inferred probe (index.html presence + sane DOM)
      - kind: workbook.build
        workbookPath: ridge-trail
      # The first skill (workbook-spa) is gated by the type="spa"
      # check above. The second skill (frontend-design) is judged by
      # the rubric — we deliberately don't hard-gate on a CSS substring
      # because valid design can live in scoped <style>, inline class
      # attributes, CSS-in-JS, or a separate stylesheet, and the SPA
      # scaffold's path layout varies across templates (src/index.html
      # vs index.html vs app/index.html). The rubric judges substance;
      # the build gate above confirms the artifact actually renders.
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Background: the agent had access to multiple skills at session
          start. We expect at least the workbook-spa skill (for the
          shape) and the frontend-design skill (for visual polish) to
          have contributed. We are not testing taste — we are testing
          that the agent COMPOSED both rather than firing one and
          dropping the other.

          Pass if ALL of these are true:
          1. The response confirms a SPA workbook was built at the
             "ridge-trail" slug.
          2. The response mentions at least one substantive design
             choice — color palette, typography, layout pattern,
             visual hierarchy, brand-driven element (e.g. ridge / trail
             / coffee / Boulder), or similar. Not just "I styled it".
          3. The response references the business context
             (coffee / Boulder / craft / roaster / similar) — proves
             the agent used the prompt context rather than producing
             a placeholder template.

          Fail if ANY of these are true:
          - The artifact is a stock Tailwind hero + cards layout with
            no business-specific content. Pattern: <h1>Welcome</h1>
            with three generic feature cards.
          - The response says "I cannot do visual design" or similar —
             frontend-design skill should be available; refusing means
             it did not compose.
          - The artifact omits any CSS at all (only inline default
             browser styles) — proves the design skill did not fire.
          - The response describes a non-SPA shape (document, agent,
             notebook).
          - The response references a non-existent skill or claims
             tools that were not available.
cleanup:
  - kind: substrate.remove_path
    path: ridge-trail
---

# skills/compose-authoring-design

**Question:** when a request spans two skills, does the agent compose
them — picking the shape from one and the discipline from another?
(Tracker: `q-skills-composition`.)

The Workbooks core skill set ships **workbook-spa** (the shape
authority) and **frontend-design** (the visual discipline). A real
"build me a landing page" ask requires both: choose SPA-shape and
apply non-generic visual design. Failing to compose looks like either
a SPA-shape skeleton with no styling, or a beautifully designed
page that does not actually build as a workbook.

Gates are stacked from concrete to interpretive:

- `substrate.file_exists` — the workbook landed
- `substrate.file_contains type: "spa"` — workbook-spa skill resolved
  + the agent invoked it
- `workbook.build` — the artifact compiles
- `substrate.file_contains ":root"` — at least one custom CSS variable
  exists in the rendered HTML; this is a cheap heuristic for "the
  agent wrote real styles" and avoids us having to judge taste in a
  hard gate
- `rubric.passes` — both skills' fingerprints are visible in the
  description, and the response references the actual business

The rubric's Fail-if list is structured so a generic Tailwind cards
output cannot pass — the most likely "single skill fired" failure
mode given how training data biases agents toward stock layouts.
