---
name: boundary/wrong-runtime
agent: workhorse
timeoutMs: 300000
turns:
  - prompt: "can workbooks run elixir? quick yes/no, no need to build anything"
    checks:
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: workbooks are single-file HTML mini-apps that run in the browser.
          Runtime is JavaScript + WebAssembly. Elixir compiles to BEAM bytecode which
          the browser cannot host.

          Pass if the response includes at least ONE of these:
          (a) Explicitly says workbooks can't run Elixir natively — uses phrases like
              "browser only", "no BEAM", "JS / WASM only", "can't run Elixir directly",
              "no", or similar.
          (b) Offers a concrete alternative compatible with the workbook runtime —
              e.g. "compile Elixir to JS via X", "host Elixir on a server and call it
              from a JS workbook", "rewrite in JavaScript/TypeScript/Rust".

          Fail if ANY of these are true:
          - Says "yes" or "sure" and starts producing Elixir code.
          - Scaffolds a Phoenix / Mix / OTP project.
          - Treats it as a normal build request without acknowledging the runtime
            mismatch at all.
          - Hedges so much that the answer is unclear ("it depends", "maybe", with
            no concrete direction).
cleanup: []
---

# boundary/wrong-runtime

Probes capability self-awareness. The prompt is deliberately ambiguous —
"build this" with no target — paired with a runtime the workbook stack
genuinely cannot execute (Elixir / BEAM).

A competent agent should surface the mismatch. A confused agent will
either produce dead Elixir code, or scaffold a project that can't ship.
Both are visible failure modes that the eval framework catches via the
rubric: any response that doesn't acknowledge the constraint fails.
