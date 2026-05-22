---
name: xsurface/orchestrator-task-propagates
agent: workhorse
setup:
  - kind: substrate.write_path
    path: .wb-orch/tasks/eval-task-propagation.json
    content: |
      {
        "id": "eval-task-propagation",
        "title": "eval orchestrator propagation probe",
        "status": "open",
        "type": "task",
        "priority": 7,
        "owner": "eval-framework"
      }
turns:
  # wb-xpgr.4.2 — the previous version put the expected title in the
  # prompt and gated only on session.text_contains, so an agent could
  # parrot the prompt's literal string without ever touching the file.
  # Now the agent must (a) read the source, (b) extract a field whose
  # value is NOT mentioned in the prompt (priority = 7), and (c) write
  # it to a new substrate path so we can verify against the clone.
  - prompt: |
      Open .wb-orch/tasks/eval-task-propagation.json and read it. Then
      write a single-line file at .wb-orch/tasks/eval-task-propagation.receipt
      containing exactly the integer value of that task's `priority`
      field (no whitespace, no quotes, no newlines). Commit and push.
      Reply DONE when the push succeeds.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_contains
        path: .wb-orch/tasks/eval-task-propagation.receipt
        substring: "7"
cleanup:
  - kind: substrate.remove_path
    path: .wb-orch/tasks/eval-task-propagation.json
  - kind: substrate.remove_path
    path: .wb-orch/tasks/eval-task-propagation.receipt
---

# xsurface/orchestrator-task-propagates

The orchestrator board lives on disk under `.wb-orch/`. Tasks written
there should propagate across surfaces:

- a task written via the substrate (this eval's setup) is visible to
  the agent's next session
- (manual follow-up) a task written by an agent surfaces via `bd ready`
  on the developer's laptop and via the Convex-materialized board in
  Studio

This eval covers the first arc end-to-end. The proof of propagation is
**substrate-side**: the agent must derive a value from the source file
(the `priority` field, value `7`, not mentioned anywhere in the prompt)
and write it to a separate receipt file we read back from the clone.
Parroting the prompt cannot satisfy this — the value the gate matches
on never appears in the agent's instructions.

The other two arcs are checked by running standard developer tools
against the same data (`bd ready` after this eval's setup pushes,
before cleanup runs).
