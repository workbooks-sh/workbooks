---
name: worg/orchestrator-dag-walk
agent: workhorse
runtime: beam
timeoutMs: 300000
turns:
  - prompt: |
      Write to /tasks.org:

          * NEXT Ship OAuth + capability resolver MVP
          :PROPERTIES:
          :ID: ship-oauth-mvp
          :END:

          ** NEXT Land the capability resolver
          :PROPERTIES:
          :ID: capability-resolver
          :PARENT: ship-oauth-mvp
          :END:

          *** NEXT Decide capability slug format
          :PROPERTIES:
          :ID: slug-format
          :PARENT: capability-resolver
          :END:
          :CONTEXT:
          - The parent (capability-resolver) needs to bind tasks to
            agent abilities (GitHub OAuth, LLM provider, …).
          - The grandparent (ship-oauth-mvp) chose protocol-namespaced
            identifiers as the project-wide convention.
          :END:

      Your job: complete slug-format ONLY. To do it correctly you
      must walk the PARENT chain to find the root goal's
      convention, then write your decision into slug-format's
      :PROPERTIES: as `:SLUG_FORMAT_DECISION: <your-choice>`,
      flip slug-format to DONE.

      Reply with: "ROOT_GOAL: <one-line summary>" on one line and
      "DECISION: <the chosen format>" on the next.
    checks:
      - kind: session.tool_called
        name: worg_query
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: "ROOT_GOAL:"
      - kind: session.text_contains
        substring: "DECISION:"
      - kind: substrate.file_contains
        path: tasks.org
        substring: ":SLUG_FORMAT_DECISION:"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: the agent must follow the :PARENT: chain
          slug-format → capability-resolver → ship-oauth-mvp to
          discover the root convention (protocol-namespaced
          identifiers like "oauth:github" or "llm:anthropic").

          Pass if ALL:
          1. ROOT_GOAL line names the ship-oauth-mvp headline (not
             one of the intermediate parents).
          2. DECISION line is a slug format that uses a
             protocol-namespace shape (colon-separated, e.g.
             "<protocol>:<provider>" or "<namespace>:<resource>").
          3. The chosen format is recorded in the slug-format
             headline's :PROPERTIES:.
          4. slug-format is now DONE.

          Fail if:
          - The agent picked a format that doesn't honor the
            protocol-namespacing convention from the root
            (e.g. CamelCaseSlugs, snake_case, plain words).
          - The agent stopped at the immediate parent and didn't
            walk to ship-oauth-mvp.
          - The agent completed capability-resolver or
            ship-oauth-mvp too. The task was explicitly
            slug-format ONLY.
cleanup:
  - kind: substrate.remove_path
    path: tasks.org
---

# worg/orchestrator-dag-walk (Layer 3 — orchestration via worg)

Tests the thesis that worg can substitute for `.wb-orch/tasks/{id}.json`
in the orchestrator protocol. A DAG of tasks, parent links via
:PARENT: properties, context that lives on each node and must be
walked to find root-goal intent.

The orchestrator protocol stores this as separate JSON files. This
spec exercises the same shape in a single .org file. If it works,
the protocol's task storage and worg are interchangeable — pick
whichever fits the surface.

The key behavior: the agent walks parent links to find context, then
records its decision in its own headline's :PROPERTIES: where the
parent (capability-resolver) can read it next. Context flows up
the chain at query time; results flow back via properties.
