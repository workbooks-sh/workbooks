---
name: xsurface/agent-write-then-cli-clone
agent: workhorse
turns:
  - prompt: "Create a file at eval-fixtures/agent-wrote-this.txt with the contents 'OPALSPRING'. Commit and push to the substrate. Reply OK when finished."
    checks:
      - kind: session.text_contains
        substring: [OK, Ok, ok]
  - prompt: "Confirm the file exists. Reply with just the word DONE."
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_contains
        path: eval-fixtures/agent-wrote-this.txt
        substring: OPALSPRING
cleanup:
  - kind: substrate.remove_path
    path: eval-fixtures/agent-wrote-this.txt
---

# xsurface/agent-write-then-cli-clone

Proves the cross-surface loop in the agent → substrate → CLI direction:
the agent writes a file in its sandbox, the sandbox pushes to the
substrate, and an INDEPENDENT clone (the eval framework's clone, not
the agent's sandbox) sees the file with the expected content.

The substrate check refreshes the clone before reading, so we observe
post-push state.
