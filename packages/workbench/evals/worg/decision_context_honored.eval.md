---
name: worg/decision-context-honored
agent: workhorse
runtime: beam
timeoutMs: 240000
turns:
  - prompt: |
      Write to /work.org:

          * NEXT Add a fuzzy string match helper
          :PROPERTIES:
          :ID: fuzzy-match
          :END:
          :NOTES:
          - We previously tried using Levenshtein from an external
            lua-rocks package and got bitten by sandbox install
            issues. DO NOT pull in an external library; write the
            distance function inline.
          - The target use case is short strings (< 50 chars), so
            naive O(n*m) DP is fine. No need for tries / FM-index /
            anything fancy.
          :END:

      Implement /src/fuzzy.lua honoring the constraints in the :NOTES:
      drawer. Verify with lua_eval that distance("kitten", "sitting")
      returns 3. Mark fuzzy-match DONE. Reply "DONE".
    checks:
      # Reading the .org file is the load-bearing behavior — accept any
      # canonical org-read tool OR plain `read`. They all surface the
      # :NOTES: drawer content the rubric checks against. (Sister spec
      # worg/find_next_implicit already uses this any-of form; this spec
      # had a single-tool list inconsistent with the rest of the suite.)
      - kind: session.tool_called
        name: [worg_parse, worg_query, read]
      - kind: session.tool_called
        name: lua_eval
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: [DONE, Done]
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: the :NOTES: drawer captured TWO constraints from
          prior decisions: (a) no external library, (b) naive DP is
          fine, no fancy structures.

          Pass if ALL:
          1. The implementation is pure inline Lua — no require()
             of an external module, no rocks/luarocks references.
          2. The approach is described as / appears to be naive
             dynamic programming (or simpler — character-by-character
             comparison). No trie, no n-gram, no FM-index.
          3. The distance("kitten", "sitting") test returned 3.

          Fail if:
          - The implementation references an external library.
          - The implementation uses something more exotic than DP
            for the short-string use case.

          This is the core test of whether agents READ decision
          context co-located with work, or whether they ignore the
          drawer and improvise.
---

# worg/decision-context-honored (Layer 3 — the Pathmode test)

The Pathmode critique made concrete: a ticket today describes work,
not the decision behind it. The :NOTES: drawer here carries explicit
prior-decision context ("we tried X, don't do it again"). If the
agent reads only the headline and ignores the drawer, it'll
reach for the lib that previously failed. If it reads the drawer,
it'll go inline DP.

This is the test that proves worg captures intent + constraints,
not just work.
