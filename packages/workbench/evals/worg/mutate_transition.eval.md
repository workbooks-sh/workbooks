---
name: worg/mutate-transition
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write to /todo.org:

          * TODO Ship onboarding flow
          :PROPERTIES:
          :ID: ship-onboarding
          :END:

      Now transition that headline from TODO to DONE using worg_mutate
      (op: "transition", target_id: "ship-onboarding", new_state: "DONE").
      After the mutation, read /todo.org back and confirm the headline
      now begins with "* DONE" instead of "* TODO".

      Reply with the line: "TRANSITIONED: <first line of the headline>"
    checks:
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.tool_called
        name: read
      - kind: session.text_contains
        substring: "* DONE"
      - kind: session.text_contains
        substring: "ship-onboarding"
---

# worg/mutate-transition

Smallest viable mutation gate. Proves `worg_mutate` lands the change
in the actual `.org` file (not just an in-memory copy). The
post-mutation read is the verification step — without it the agent
could claim success without the bytes actually changing.
