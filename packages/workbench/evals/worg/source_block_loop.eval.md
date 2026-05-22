---
name: worg/source-block-loop
agent: workhorse
runtime: beam
timeoutMs: 360000
turns:
  - prompt: |
      Write to /pipeline.org:

          * Setup
          :PROPERTIES:
          :ID: setup-step
          :END:

          #+BEGIN_SRC bash
          mkdir -p /data
          echo "raw,3,7,11,5,2,13" > /data/input.csv
          #+END_SRC

          * NEXT Sum the numeric cells
          :PROPERTIES:
          :ID: sum-step
          :END:

          #+BEGIN_SRC lua
          -- Read /data/input.csv, skip the header column, sum the
          -- remaining numbers as integers, return the total.
          local f = io.open("/data/input.csv", "r")
          local line = f:read("*l")
          f:close()
          local total = 0
          for token in string.gmatch(line, "[^,]+") do
            local n = tonumber(token)
            if n then total = total + n end
          end
          return total
          #+END_SRC

      Execute the pipeline in order:
      1. Run the bash source block in Setup.
      2. Run the lua source block in Sum the numeric cells; the
         result should be 41.
      3. Mark sum-step DONE via worg_mutate.
      4. Reply with "PIPELINE_TOTAL=<n>"
    checks:
      - kind: session.tool_called
        name: [bash, run_command]
      - kind: session.tool_called
        name: lua_eval
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: "PIPELINE_TOTAL=41"
---

# worg/source-block-loop (Layer 3)

A plan-as-program. Each headline has an embedded source block in a
specific language; the agent walks the plan in order, dispatches each
block to the right runtime (bash → bash tool, lua → lua_eval),
threads state via the filesystem, and marks completion.

This is composability AS execution: the .org file is the entire
pipeline spec; the agent is the dispatcher.
