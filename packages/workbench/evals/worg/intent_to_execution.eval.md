---
name: worg/intent-to-execution
agent: workhorse
runtime: beam
timeoutMs: 360000
turns:
  - prompt: |
      Write to /work.org:

          * NEXT Build a daily-water-intake counter
          :PROPERTIES:
          :ID: water-counter
          :SUCCESS_CRITERIA: a Lua function inc(n) that increments a
                             running total; exposed as a getter
                             total(); persists between calls within
                             the session
          :CONSTRAINTS: pure Lua, no external libraries, single file
                       at /src/water.lua
          :END:

      Execute that task end-to-end:
      1. Read the worg headline + its properties.
      2. Implement it according to SUCCESS_CRITERIA and CONSTRAINTS.
      3. Verify with lua_eval (inc(3), inc(2), total() should be 5).
      4. Use worg_mutate to mark water-counter DONE.
      5. Reply DONE.
    checks:
      - kind: session.tool_called
        name: [worg_parse, worg_query, read]
      - kind: session.tool_called
        name: write
      - kind: session.tool_called
        name: lua_eval
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: [DONE, Done]
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL:
          1. The agent describes implementing /src/water.lua AND
             verifies with lua_eval producing the value 5.
          2. The agent honored CONSTRAINTS (no external libraries
             mentioned).
          3. The agent transitioned water-counter to DONE via
             worg_mutate.

          Fail if:
          - The agent skipped lua_eval verification.
          - The agent imported any external lua module.
          - The state was not transitioned to DONE.
---

# worg/intent-to-execution (Layer 3 — the loop)

THE key Linear-thesis test. The .org file is the only authoritative
spec: the agent must (a) extract intent from :PROPERTIES:
(SUCCESS_CRITERIA + CONSTRAINTS), (b) execute against that intent,
(c) self-verify, (d) record completion in the same file. No
out-of-band ticket, no PM brief — the plan IS the work.

This is "context → execution" as a single substrate.
