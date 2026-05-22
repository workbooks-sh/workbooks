---
name: worg/query-by-state
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write this plan to /backlog.org:

          * TODO Migrate auth flow
          :PROPERTIES:
          :ID: auth-migrate
          :END:

          * NEXT Add rate limiting
          :PROPERTIES:
          :ID: rate-limit
          :END:

          * NEXT Document the SDK
          :PROPERTIES:
          :ID: doc-sdk
          :END:

          * WAITING Vendor security review
          :PROPERTIES:
          :ID: vendor-review
          :END:

          * DONE Set up CI
          :PROPERTIES:
          :ID: ci-setup
          :END:

      Use worg_query to find every headline in state NEXT. List their
      IDs in order. Wrap them as: "NEXT_IDS: id1, id2, ..."
    checks:
      - kind: session.tool_called
        name: worg_query
      - kind: session.text_contains
        substring: "rate-limit"
      - kind: session.text_contains
        substring: "doc-sdk"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. The response lists both rate-limit and doc-sdk as NEXT.
          2. The response does NOT include auth-migrate, vendor-review,
             or ci-setup in the NEXT list.

          Fail if any TODO/WAITING/DONE id appears in the NEXT list.
---

# worg/query-by-state

Verifies `worg_query` filters by TODO state correctly. Critical for
"what should I work on next" agent behavior — the smallest planning
primitive.
