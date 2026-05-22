---
name: substrate/contextually-added-files
agent: workhorse
turns:
  - prompt: |
      For each path below, reply with one line: "PATH: yes" if the path exists in your current working
      directory and is readable, or "PATH: no" otherwise. Reply ONLY those lines, in this exact order:
      - AGENTS.md
      - .pi/SYSTEM.md
      - .gitignore
      - decoy/does-not-exist.md
    checks:
      # wb-xpgr.4.3 — restore the tool_called gate so the agent has to
      # observably read/list the filesystem, and add a decoy path that
      # MUST come back "no" so blanket "yes" answers fail.
      - kind: session.tool_called
        name: ["read", "bash", "ls", "list_dir", "glob"]
      - kind: session.text_contains
        substring: "AGENTS.md: yes"
      - kind: session.text_contains
        substring: ".pi/SYSTEM.md: yes"
      - kind: session.text_contains
        substring: ".gitignore: yes"
      - kind: session.text_contains
        substring: "decoy/does-not-exist.md: no"
---

# substrate/contextually-added-files

Verifies the agent's sandbox has the contextually-added files in place
when the session boots. These files are scaffolded into the agent's
working directory at session-start time (NOT through the substrate),
so we observe them via the agent's own read-tool rather than via a
substrate clone.

A parrot agent that always answers "yes" would pass three of the four
substring checks — the `decoy/does-not-exist.md: no` line is the
discriminating gate, alongside `session.tool_called` which requires
the agent to have observably touched the filesystem.

Adjust the path list to match the actual scaffolding contract once
that surface is stable.
