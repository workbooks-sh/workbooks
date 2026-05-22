---
name: worg/two-agent-via-states
agent: workhorse
runtime: beam
timeoutMs: 360000
turns:
  - prompt: |
      Write to /board.org:

          * TODO Compute hash of /src/main.lua
          :PROPERTIES:
          :ID: compute-hash
          :ASSIGNED_TO: specialist
          :END:

      Then write /src/main.lua containing exactly: print("hello world")

      Now coordinate this work with a specialist agent:
      1. Use delegate_to_agent to hand off compute-hash. The delegate
         prompt should mention /board.org and ask the specialist to
         (a) find compute-hash via worg_query, (b) compute the
         sha256 of /src/main.lua, (c) write the hash into the
         :PROPERTIES: block of compute-hash via worg_mutate, (d) flip
         the state to DONE.
      2. After the delegate returns, read /board.org and confirm:
         - compute-hash is now DONE
         - it has a HASH or SHA256 property with a 64-char hex value
      3. Reply with the line "HANDOFF_COMPLETE sha=<the hex hash>"
    checks:
      - kind: session.tool_called
        name: delegate_to_agent
      - kind: session.tool_called
        name: read
      - kind: session.text_contains
        substring: "HANDOFF_COMPLETE"
      - kind: session.text_contains
        substring: "* DONE"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL:
          1. Workhorse called delegate_to_agent (not just claimed to).
          2. The reply includes "HANDOFF_COMPLETE sha=" followed by
             a 64-char hex value (sha256 of `print("hello world")`,
             with optional trailing newline depending on writer).
          3. The reply confirms compute-hash transitioned to DONE.

          Fail if Workhorse did the hash itself without delegating,
          or if the property update is described but not actually
          present in the file.
---

# worg/two-agent-via-states (Layer 3 — the handoff test)

The Linear "handoff is dead" claim re-tested: handoffs aren't dead,
they just need to happen through a shared substrate rather than
through tickets-in-a-queue. Workhorse grafts work onto /board.org with
an ASSIGNED_TO property, delegates to a specialist, and the specialist
uses the SAME .org file as both the input ("what should I do") and
the output (state + result property).

Two-agent coordination through worg state, no intermediate ticket
system. If this works, worg IS the agent-coordination substrate.
