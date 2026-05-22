---
name: worg/mutate-create-headline
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write to /project.org:

          * NEXT Release v1.0
          :PROPERTIES:
          :ID: release-v1
          :END:

      Use worg_mutate to add a CHILD headline under release-v1:

          ** TODO Tag the release
          :PROPERTIES:
          :ID: tag-release
          :END:

      (op: "create_headline", parent_id: "release-v1", new_headline:
      with the above shape — the exact arg names depend on the worg
      surface, use what's in your skill bundle.)

      After the mutation, read /project.org and confirm both
      release-v1 AND tag-release are present, with tag-release nested
      under release-v1 (one extra asterisk on its headline line).

      Reply with the line "CREATED: <id of the new child>"
    checks:
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.tool_called
        name: read
      - kind: session.text_contains
        substring: "release-v1"
      - kind: session.text_contains
        substring: "tag-release"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if:
          1. The response confirms tag-release was created.
          2. The response shows or describes tag-release as a child of
             release-v1 (nested, "** TODO" depth, "under", "child", etc.).

          Fail if the response describes tag-release as a sibling or
          top-level item.
---

# worg/mutate-create-headline

Composability gate. Plans are trees — adding a sub-task under a parent
is the foundational operation for plan-of-plans / decomposition flows.
Verifies `worg_mutate` does hierarchical insertion correctly and the
on-disk depth (asterisks) reflects parent/child semantics.
