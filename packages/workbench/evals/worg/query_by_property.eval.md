---
name: worg/query-by-property
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write to /sprint.org:

          * NEXT Refactor caching layer
          :PROPERTIES:
          :ID: cache-refactor
          :OWNER: alice
          :ESTIMATE: 3d
          :END:

          * NEXT Add metrics dashboard
          :PROPERTIES:
          :ID: metrics-dash
          :OWNER: bob
          :ESTIMATE: 1d
          :END:

          * NEXT Write integration tests
          :PROPERTIES:
          :ID: int-tests
          :OWNER: alice
          :ESTIMATE: 2d
          :END:

      Use worg_query with a property filter (OWNER=alice) and list the
      matching headline IDs. Reply with: "ALICE_OWNS: id1, id2"
    checks:
      - kind: session.tool_called
        name: worg_query
      - kind: session.text_contains
        substring: "cache-refactor"
      - kind: session.text_contains
        substring: "int-tests"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if:
          1. cache-refactor and int-tests are both in the ALICE_OWNS list.
          2. metrics-dash is NOT in the ALICE_OWNS list (it's owned by bob).

          Fail otherwise.
---

# worg/query-by-property

Custom properties in `:PROPERTIES:` blocks are the extensibility hook
that maps cleanly to issue-tracker concepts (owner, estimate, tags).
This gate verifies `worg_query` reads them and filters on them.
