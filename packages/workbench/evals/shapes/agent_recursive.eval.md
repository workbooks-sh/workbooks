---
name: shapes/agent-recursive
agent: workhorse
timeoutMs: 1500000
turns:
  - prompt: |
      Make me an agent that monitors my Twitter mentions. Use the slug
      "mention-monitor" exactly, place it at the substrate root as a
      type:"agent" workbook, push the full tree, then reply DONE when
      the push succeeds.
    checks:
      # USE PAIRED — DONE is paired with multiple substrate-side
      # anchors below. The recursive case is the most gameable shape
      # (agents writing agent specs sounds like agents) so the gates
      # are stacked tightly.
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_exists
        path: mention-monitor/workbook.config.mjs
      # Anchor #1 — template choice.
      - kind: substrate.file_contains
        path: mention-monitor/workbook.config.mjs
        substring: 'type: "agent"'
      # Anchor #2 — the manifest has an agent block (not just a
      # type:"agent" header with the rest of the config absent).
      - kind: substrate.file_contains
        path: mention-monitor/workbook.config.mjs
        substring: "agent:"
      # Anchor #3 — the agent block has a systemPrompt key (canonical
      # in templates/agent/workbook.config.mjs). Catches the
      # "manifest declares type:agent but never wires the loop"
      # anti-pattern.
      - kind: substrate.file_contains
        path: mention-monitor/workbook.config.mjs
        substring: "systemPrompt"
      # Anchor #4 — tools array is declared. A monitor-mentions agent
      # without a tools surface is non-functional, but more
      # importantly, the canonical template always emits `tools:`.
      - kind: substrate.file_contains
        path: mention-monitor/workbook.config.mjs
        substring: "tools"
      # Build + shape-inferred probe (script[type="module"] — agent
      # type uses the same SPA-shaped renderable preview as default).
      - kind: workbook.build
        workbookPath: mention-monitor
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. Confirms an agent-shape workbook was scaffolded (mentions
             the slug "mention-monitor", a directory, or "I created /
             scaffolded / built").
          2. Describes how the agent is wired: at minimum a system
             prompt (mission, behavior) AND at least one tool /
             integration / capability for actually reading mentions
             (Twitter API, an MCP tool, a connector, a polling
             schedule).
          3. Distinguishes Studio-shaped agents from a one-off script:
             references the agent loop, tools, or the broker / agent
             runtime in some form.

          Fail if ANY of these are true:
          - The response is only a clarifying question with no artifact
            produced.
          - The response is so terse it can't be verified ("done.",
            "agent built.").
          - The artifact described is a plain SPA dashboard or
            scheduled script, not an agent definition with a
            systemPrompt + tools surface.
          - The response refuses, says "I cannot", or proposes an
            alternative without doing the task.
          - Twitter / mentions are not mentioned at all in the
             description (generic agent skeleton).
cleanup:
  - kind: substrate.remove_path
    path: mention-monitor
---

# shapes/agent-recursive

The recursive case: a Workhorse agent authoring another agent's
definition. The artifact is itself a workbook of `type: "agent"`,
whose `workbook.config.mjs` carries the canonical fields read by the
workbooks-agent backend on publish (systemPrompt + tools at minimum).

Why this matters: an agent that can scaffold other agents is the
substrate's recursion proof — the agent surface treated as a
first-class artifact type. The risk is shape-leak: the agent
producing a plain SPA "with agent-like UI" instead of the real
type:"agent" manifest the backend can publish.

Stacked anchors specifically defend against that:

- `substrate.file_contains 'type: "agent"'` — pins the template.
- `substrate.file_contains "agent:"` — the agent block exists.
- `substrate.file_contains "systemPrompt"` — the loop is wired,
  not just declared.
- `substrate.file_contains "tools"` — the tool surface is present.

Three of those four anchors are NOT in the user's prompt (only the
word "agent" is), so a parrot can't satisfy them by echoing.
Together they're the canonical manifest shape from
`templates/agent/workbook.config.mjs`.

`workbook.build` plus the default agent-shape probe verifies the
renderable preview page compiles. The rubric layers a content check
on top — Twitter mentions must be addressed in the description, and
the agent must be described as agent-shaped (systemPrompt + tools,
not a polling script).
