---
name: worg/plan-as-prompt
agent: workhorse
runtime: beam
timeoutMs: 300000
turns:
  - prompt: |
      /plan.org
    setup:
      - kind: substrate.write
        path: plan.org
        content: |
          * Project: parse-config

          ** NEXT Implement JSON config parser
          :PROPERTIES:
          :ID: parser
          :END:
          :SUCCESS_CRITERIA:
          - parse_config(text) returns a Lua table.
          - Round-trips: serialize(parse_config(text)) ≈ text (whitespace excepted).
          - Empty string returns an empty table, not nil.
          :END:
          :IMPLEMENTATION:
          - File: /src/parser.lua
          - Use string.match / string.gsub for tokenization. No
            external libraries.
          - JSON subset: objects, arrays, strings, numbers, true,
            false, null. No nested escapes in strings.
          :END:

          ** NEXT Smoke-test the parser
          :PROPERTIES:
          :ID: smoke
          :END:
          :SUCCESS_CRITERIA:
          - lua_eval of parse_config('{"a": 1}') returns {a=1}.
          - lua_eval of parse_config('') returns {}.
          :END:

    checks:
      - kind: session.tool_called
        name: worg_parse
      - kind: session.tool_called
        name: write
      - kind: session.tool_called
        name: lua_eval
      - kind: session.tool_called
        name: worg_mutate
      - kind: substrate.file_exists
        path: src/parser.lua
      - kind: substrate.file_contains
        path: plan.org
        substring: "* DONE"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: the user message was literally just "/plan.org".
          No instructions, no questions. The agent was expected to
          read the file and infer what to do from its structure
          alone — NEXT headlines, :SUCCESS_CRITERIA:,
          :IMPLEMENTATION: properties.

          Pass if ALL:
          1. The agent read /plan.org (worg_parse called).
          2. /src/parser.lua exists and is a JSON parser (not
             stub / placeholder).
          3. The smoke checks were run via lua_eval — at least
             parse_config('{"a": 1}') returning {a=1}.
          4. At least one of the two headlines reached DONE.

          Fail if:
          - The agent asked clarifying questions instead of
             reading the file ("What would you like me to do
             with plan.org?"). The whole point is that the .org
             file IS the prompt.
          - The agent only printed the file content back and
            stopped.
          - The agent treated "/plan.org" as a path to dump,
            not a plan to execute.
          - The implementation skipped :IMPLEMENTATION: guidance
            and reached for an external library.
cleanup:
  - kind: substrate.remove_path
    path: plan.org
  - kind: substrate.remove_path
    path: src/parser.lua
---

# worg/plan-as-prompt (Layer 3 — the thesis test)

The Linear thesis claim: "the .org file IS the substrate, not a
thin abstraction over a ticket queue." The strongest form of that
claim is: an agent given ONLY the path to a .org file, with no
instructions in the chat message, infers what work to do and does
it.

Existing Layer 3 specs all start with a turn prompt that narrates
the worg file. This one strips the narration. The user message is
literally "/plan.org" — a path. The plan file does all the talking
via headline states (NEXT), success criteria, and implementation
properties.

If the agent:
1. Reads the file,
2. Identifies NEXT headlines as work,
3. Honors per-headline :IMPLEMENTATION: and :SUCCESS_CRITERIA:,
4. Self-verifies and transitions to DONE,
then worg actually IS the planning substrate. If the agent asks
"what do you want me to do with this?", the substrate is failing
its job of carrying intent.

This is the most ambitious worg spec — it doesn't test a feature,
it tests the architectural claim.
