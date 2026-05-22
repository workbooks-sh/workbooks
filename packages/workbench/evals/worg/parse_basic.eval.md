---
name: worg/parse-basic
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write this org-mode plan to /plan.org:

          * TODO Buy groceries
          :PROPERTIES:
          :ID: task-groceries
          :ESTIMATE: 30min
          :END:
          We need milk, bread, eggs.

          * NEXT Write report
          :PROPERTIES:
          :ID: task-report
          :END:
          Quarterly summary.

          * DONE Take out trash
          :PROPERTIES:
          :ID: task-trash
          :END:

      Then use worg_parse on /plan.org and tell me how many headlines
      are in each state (TODO/NEXT/DONE). Reply with the line:
      "STATES: TODO=N NEXT=N DONE=N"
    checks:
      - kind: session.tool_called
        name: write
      - kind: session.tool_called
        name: worg_parse
      - kind: session.text_contains
        substring: "TODO=1"
      - kind: session.text_contains
        substring: "NEXT=1"
      - kind: session.text_contains
        substring: "DONE=1"
---

# worg/parse-basic

Smallest viable gate: agent authors an `.org` file with multiple
TODO states, then parses it back with `worg_parse` and surfaces a
per-state count. Proves the parse-side of the worg surface works
end-to-end through the LLM tool-call path.

What this proves:
- write tool can place content at /plan.org
- worg_parse returns structured state information
- agent can aggregate parse output and emit a deterministic summary
