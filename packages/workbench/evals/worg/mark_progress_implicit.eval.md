---
name: worg/mark-progress-implicit
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write to /sprint.org:

          * NEXT Refactor auth middleware
          :PROPERTIES:
          :ID: auth-refactor
          :END:

          * NEXT Update docs for v2 API
          :PROPERTIES:
          :ID: doc-v2
          :END:

      I just finished refactoring the auth middleware.
    checks:
      - kind: session.tool_called
        name: worg_mutate
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Setup context: the user reported in natural language that
          they finished one of the items in /sprint.org. The right
          move is for the agent to call worg_mutate to transition
          auth-refactor from NEXT to DONE.

          Pass if ALL of these are true:
          1. The agent called worg_mutate (transition op or
             equivalent) targeting auth-refactor.
          2. The agent moved auth-refactor to DONE (not just to
             IN_PROGRESS or DONE-with-typos).
          3. The agent did NOT touch doc-v2 — it should be untouched.
          4. The response acknowledges the change in user-facing
             language.

          Fail if:
          - The agent only said "great!" without mutating.
          - The agent updated the wrong headline.
          - The agent moved both items.
---

# worg/mark-progress-implicit (Layer 2)

The conversational shape of "I just finished X" — agent must map to
the right headline ID and the right state transition without an
explicit tool name. Tests the "I just shipped X, mark it done" idiom
that every issue tracker has to handle gracefully.
