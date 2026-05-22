---
name: worg/multi-step-plan
agent: workhorse
runtime: beam
timeoutMs: 360000
turns:
  - prompt: |
      Write to /sprint.org:

          * NEXT Create a fibonacci helper at /src/fib.lua
          :PROPERTIES:
          :ID: fib-helper
          :END:

          * NEXT Add a memoizing cache around the helper
          :PROPERTIES:
          :ID: fib-cache
          :END:

          * NEXT Verify with lua_eval that fib(20) returns 6765
          :PROPERTIES:
          :ID: fib-verify
          :END:

      Work through the plan in order. After completing each NEXT
      headline:
      1. Use worg_mutate to transition it to DONE.
      2. Read /sprint.org back to confirm your own progress.
      3. Pick up the next NEXT item.

      When all three are DONE, reply: "PLAN_COMPLETE"
    checks:
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.tool_called
        name: lua_eval
      - kind: session.text_contains
        substring: "6765"
      - kind: session.text_contains
        substring: PLAN_COMPLETE
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL:
          1. The response shows or describes that ALL three headlines
             (fib-helper, fib-cache, fib-verify) reached DONE.
          2. The agent re-read /sprint.org at least once between
             transitions to observe its own progress.
          3. The verification step produced 6765 (fib(20)).

          Fail if:
          - Any headline was left as NEXT or TODO.
          - The agent transitioned all three at the end without
             intermediate re-reads (skipping the "return to plan"
             reflection step).
---

# worg/multi-step-plan (Layer 3 — the drift test)

The "plan drift" loop. After executing each step the agent must
RETURN to the plan, observe its own progress, and pick up the next
item. This is the test that fails when an agent treats the .org file
as a one-shot context dump rather than a living state. Linear's
"context becomes execution" loop is exactly this round-trip pattern.
