---
name: xsurface/cli-push-then-agent-sees
agent: workhorse
setup:
  - kind: substrate.write_path
    path: eval-fixtures/cli-push-then-agent-sees.txt
    content: "the secret value is QUARTZWIND"
turns:
  - prompt: "Read the file eval-fixtures/cli-push-then-agent-sees.txt and tell me the secret value. Reply with just the word."
    checks:
      - kind: session.text_contains
        substring: QUARTZWIND
      - kind: session.tool_called
        name: [read, bash]
cleanup:
  - kind: substrate.remove_path
    path: eval-fixtures/cli-push-then-agent-sees.txt
---

# xsurface/cli-push-then-agent-sees

Proves the cross-surface loop in the CLI → substrate → agent direction:

1. Eval framework writes a file directly into the substrate via setup.
2. Agent session boots, clones the substrate as part of its sandbox,
   and uses some file-read tool (dedicated `read` or `bash` cat/echo)
   to retrieve the file we just pushed.
3. We assert both the surfaced value AND that the agent actually
   issued a tool call (rather than hallucinating the answer).

The tool name accepts an array — workhorse routinely picks `bash`
(cat/echo) over the dedicated `read` tool, so we accept either.
Adjust the list to match the tools your agent catalog exposes.
