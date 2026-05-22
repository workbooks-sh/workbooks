---
name: worg/decompose-implicit
agent: workhorse
runtime: beam
timeoutMs: 240000
turns:
  - prompt: |
      Write to /plan.org:

          * NEXT Build a sign-in page
          :PROPERTIES:
          :ID: signin-page
          :END:
          We need an email/password form with validation, a submit
          handler, and a redirect on success.

      That task is too big to do in one go. Help me break it down.
    checks:
      - kind: session.tool_called
        name: worg_mutate
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Setup context: the user wrote a top-level NEXT task and
          asked the agent to break it down. The right move is for
          the agent to use worg_mutate to add CHILD headlines (subtasks)
          under signin-page, then summarize the breakdown.

          Pass if ALL of these are true:
          1. The agent called worg_mutate to add subtasks (NOT just
             described subtasks in prose).
          2. The breakdown produces 3 or more sub-headlines that map
             to the parts of the work (form, validation, handler,
             redirect — at least 3 of those concepts must appear
             as sub-tasks).
          3. The sub-tasks are described as CHILDREN of signin-page,
             not as new top-level items.

          Fail if:
          - The agent only listed subtasks in prose without mutating
            the file.
          - The subtasks were added as siblings of signin-page (same
            depth).
---

# worg/decompose-implicit (Layer 2)

Tests the decomposition reflex: when a user says "help me break this
down," the agent should add child headlines, not write a new outline
in prose. Composability through `worg_mutate` is the test, with the
phrasing intentionally non-prescriptive.
