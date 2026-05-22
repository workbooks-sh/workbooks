---
name: worg/decision-revoked
agent: workhorse
runtime: beam
timeoutMs: 240000
turns:
  - prompt: |
      Write to /plan.org:

          * NEXT Persist user preferences across sessions
          :PROPERTIES:
          :ID: persist-prefs
          :END:
          :NOTES:
          - 2026-04-12 (alice): Use SQLite via the lua-sqlite binding.
            It's already a dependency and we don't need network reach.
          - 2026-05-03 (bob): REVOKED the SQLite decision above.
            Lua-sqlite was removed from the runtime allowlist in the
            April security review. Use the in-process key-value store
            exposed as kv_get(key) / kv_set(key, value). It persists
            via the workbook's own state surface.
          :END:

      Implement /src/prefs.lua that exposes set_pref(name, value) and
      get_pref(name). Honor the most recent decision in :NOTES:.
      Mark persist-prefs DONE when verified. Reply DONE.
    checks:
      - kind: session.tool_called
        name: worg_parse
      - kind: session.tool_called
        name: write
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: [DONE, Done]
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: the :NOTES: drawer has two decisions in time order.
          The second explicitly REVOKES the first and names the
          replacement (kv_get / kv_set).

          Pass if ALL:
          1. /src/prefs.lua uses kv_get / kv_set (or close paraphrase
             "kv:get", kv["foo"]=, etc.) for persistence.
          2. The implementation does NOT call any sqlite function
             (sqlite.open, db:exec, sqlite3.*).
          3. The implementation does NOT require/import a lua-sqlite
             module.
          4. The headline is now DONE in /plan.org.

          Fail if:
          - The implementation uses SQLite — that's the failure mode
            this spec catches: the agent read the FIRST decision and
            stopped, missing the revocation.
          - The agent ignored BOTH decisions and invented a third
            approach (file I/O, JSON dump, etc).
          - The agent calls out the revocation in reply but still
            implements SQLite.

          The implementation is what counts. Words that explain a
          correct approach but code that does the wrong thing fails.
cleanup:
  - kind: substrate.remove_path
    path: plan.org
  - kind: substrate.remove_path
    path: src/prefs.lua
---

# worg/decision-revoked (Layer 3 — decision lifecycle)

`decision_context_honored` tests whether the agent reads :NOTES: at
all. This tests whether the agent reads the WHOLE :NOTES: drawer
and respects ordering. Decisions accumulate over time and earlier
ones can be revoked. An agent that grabs the first plausible
decision and runs has only read the first paragraph of the context.

The failure mode is real: the FIRST decision is more specific
(mentions a concrete library) than the revocation (which describes
why and what to use instead). Agents biased toward concrete
instructions will reach for SQLite even though it's been killed.

This is the test that worg captures decision HISTORY, not just the
most-recently-asserted state.
