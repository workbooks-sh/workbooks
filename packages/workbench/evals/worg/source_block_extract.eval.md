---
name: worg/source-block-extract
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write to /plan.org:

          * NEXT Compute the answer
          :PROPERTIES:
          :ID: compute-answer
          :END:

          Run this in Lua:

          #+BEGIN_SRC lua
          local total = 0
          for i = 1, 10 do total = total + i end
          return total
          #+END_SRC

      Parse /plan.org with worg_parse, find the compute-answer
      headline, extract the lua source block from its body, and run
      that source via lua_eval. Reply with: "SUM=<result>"
    checks:
      - kind: session.tool_called
        name: worg_parse
      - kind: session.tool_called
        name: lua_eval
      - kind: session.text_contains
        substring: "SUM=55"
---

# worg/source-block-extract

The composability primitive. Org-mode source blocks
(`#+BEGIN_SRC ... #+END_SRC`) let a plan carry executable code
alongside the prose describing the work. An agent reading a plan
must be able to extract the block AND dispatch it to the right
runtime — here lua_eval. This is what makes worg an agent context
substrate, not just a notation.
