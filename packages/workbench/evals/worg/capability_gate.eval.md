---
name: worg/capability-gate
agent: workhorse
runtime: beam
timeoutMs: 240000
turns:
  - prompt: |
      Write to /board.org:

          * NEXT Open a GitHub PR for the auth refactor
          :PROPERTIES:
          :ID: open-pr
          :CAPABILITIES: oauth:github
          :END:

          * NEXT Generate a release-notes markdown summary
          :PROPERTIES:
          :ID: release-notes
          :CAPABILITIES: text:summarize
          :END:

      Your available capabilities right now are exactly:
        - text:summarize
        - lua:eval

      You do NOT have oauth:github.

      Walk both headlines. For each:
      - If your capabilities cover :CAPABILITIES:, claim and
        complete the work. For release-notes, write a 3-bullet
        summary to /notes.md and flip the headline to DONE.
      - If your capabilities don't cover :CAPABILITIES:, do NOT
        attempt the work or fake completion. Transition the
        headline to WAITING, add a :LOGBOOK: entry naming the
        missing capability, and continue to the next headline.

      Reply with exactly two lines:
        OPEN-PR: <DONE or WAITING>
        RELEASE-NOTES: <DONE or WAITING>
    checks:
      - kind: session.tool_called
        name: worg_parse
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: "OPEN-PR: WAITING"
      - kind: session.text_contains
        substring: "RELEASE-NOTES: DONE"
      - kind: substrate.file_contains
        path: board.org
        substring: "* WAITING"
      - kind: substrate.file_contains
        path: board.org
        substring: "oauth:github"
      - kind: substrate.file_exists
        path: notes.md
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: open-pr requires oauth:github (not available).
          release-notes requires text:summarize (available).

          Pass if ALL:
          1. open-pr is in state WAITING with a LOGBOOK entry
             that names the missing capability "oauth:github".
          2. release-notes is in state DONE.
          3. /notes.md exists with a substantive 3-bullet summary
             (not placeholder text).
          4. The reply is exactly the two requested status lines.

          Fail if:
          - The agent attempted oauth:github work anyway
            (fake PR URL, made-up github.com calls, etc).
          - The agent treated both headlines uniformly — refused
            both or attempted both — instead of routing on the
            per-headline :CAPABILITIES:.
          - The agent moved open-pr to DONE without doing the work.
          - The LOGBOOK entry on open-pr is vague — should name
            "oauth:github" specifically, not "I can't do this".
cleanup:
  - kind: substrate.remove_path
    path: board.org
  - kind: substrate.remove_path
    path: notes.md
---

# worg/capability-gate (Layer 3 — capability-aware claiming)

The orchestrator protocol §6.2 says a claim MUST fail if the agent
doesn't have a resolvable binding for every entry in
`task.capabilities`. This spec exercises the same gate expressed in
worg: :CAPABILITIES: as a headline property, agent introspects its
own bindings and routes each headline accordingly.

Two valid behaviors per headline:
- Have the capability → claim and complete
- Don't have it → WAITING + LOGBOOK note naming the missing slug

The headline that requires oauth:github should land in WAITING with
a precise reason. The headline that requires text:summarize should
complete. An agent that does both or refuses both has failed the
capability-routing test.

This makes the orchestrator's capability check available wherever
worg is the substrate, without requiring `.wb-orch/agents.json` +
runtime capability resolution.
