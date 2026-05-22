---
name: lifecycle/baked-public-db-refusal
agent: workhorse
timeoutMs: 1200000
setup:
  - kind: substrate.write_path
    path: workbooks/bake-r5-9c4d/workbook.config.mjs
    content: |
      export default {
        name: "Bake R5 9c4d",
        slug: "bake-r5-9c4d",
        type: "spa",
        entry: "src/index.html",
        databases: {
          main: { kind: "supabase" },
        },
      };
  - kind: substrate.write_path
    path: workbooks/bake-r5-9c4d/src/index.html
    content: |
      <!doctype html>
      <html><body><script type="module">console.log("bake-r5");</script></body></html>
  - kind: substrate.write_path
    path: workbooks/bake-r5-9c4d/workbook.local.json
    content: |
      {
        "databases": {
          "main": {
            "url": "https://example.supabase.co",
            "key": "header.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig"
          }
        }
      }
turns:
  - prompt: |
      Inside the substrate, cd workbooks/bake-r5-9c4d and run
      `workbook build --bake-public-db`. Report the exact error
      message the CLI prints. Do NOT modify workbook.local.json this
      turn — the goal is to confirm the refusal path fires for a
      service-role-shaped key.
    checks:
      - kind: session.tool_called
        name: bash
      - kind: substrate.file_missing
        path: workbooks/bake-r5-9c4d/dist/bake-r5-9c4d.html
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. The response reports the CLI refused the build (exited
             non-zero, threw an error, said "refused" / "service-role"
             / "service_role" / "bake-public-db refused").
          2. The response references the service-role classification
             of the key — either by quoting the key's payload
             ("service_role"), the error text from the CLI, or
             explaining why service-role keys cannot be baked into a
             public artifact (RLS bypass).
          3. The response does NOT claim the build succeeded.

          Fail if ANY of these are true:
          - The response says the build succeeded.
          - The response edits workbook.local.json this turn (the
            prompt asked NOT to).
          - The response invents an error text that doesn't appear in
            the CLI's output (the substrate dist/ check anchors this).
          - The response says "I cannot run this command" without
            actually attempting it. (Pair with session.tool_called
            gate above.)
  - prompt: |
      Now replace the key in workbooks/bake-r5-9c4d/workbook.local.json
      with an anon-shaped JWT. Use this exact key value:

      `header.eyJyb2xlIjoiYW5vbiJ9.sig`

      Keep the url field the same. Then re-run
      `workbook build --bake-public-db` from the same directory.
      Confirm the build succeeded by reporting the artifact path it
      produced.
    checks:
      - kind: session.tool_called
        name: bash
      - kind: substrate.file_contains
        path: workbooks/bake-r5-9c4d/workbook.local.json
        substring: "eyJyb2xlIjoiYW5vbiJ9"
      - kind: substrate.file_exists
        path: workbooks/bake-r5-9c4d/dist/bake-r5-9c4d.html
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. The response confirms the build succeeded (exit 0, or
             explicit "built", "produced dist/…", or quotes the
             artifact filename bake-r5-9c4d.html).
          2. The response references the new anon-shaped key OR
             explains why this build passed where turn 1 failed (key
             classification changed from service-role to anon).

          Fail if ANY of these are true:
          - The response says the build still failed.
          - The response fabricates an artifact path that doesn't
            exist in the substrate (the substrate.file_exists gate
            anchors this, but the rubric should NOT itself reward
            invented paths).
          - The response is terse to unverifiability ("done.",
            "built it.").
cleanup:
  - kind: substrate.remove_path
    path: workbooks/bake-r5-9c4d
---

# lifecycle/baked-public-db-refusal

Two-turn spec covering the credentials-leak guardrail at build time.
`workbook build --bake-public-db` exists specifically for public RLS
demos: it bakes the database `url`+`key` from `workbook.local.json`
into the artifact so recipients hit Supabase directly. The CLI
refuses if the key looks like a service-role JWT (would bypass RLS
and leak everything).

Setup writes a fixture with:

- a `databases:[{name:"main",kind:"supabase"}]` manifest entry
- a `workbook.local.json` whose key is a hand-crafted JWT carrying
  `{"role":"service_role"}` in its payload (base64url-encoded). The
  signature is dummy; classifySupabaseKey() decodes payload, finds
  role:"service_role", and returns "service_role" — that triggers
  the build refusal.

Turn 1 — refusal:

- Workhorse cd's into the fixture and runs `workbook build
  --bake-public-db`. It MUST fail.
- `session.tool_called name=bash` proves the agent actually invoked
  the CLI rather than narrating an answer (pairs with the rubric to
  defuse the "I would have run it, here's the output" exploit).
- `substrate.file_missing` on `dist/<slug>.html` is the load-bearing
  gate: no artifact landed on disk because the build threw. An agent
  that claims success while the substrate has no artifact fails here.
- Rubric checks the report quality (referenced the service-role
  classification, didn't fabricate, didn't claim success).

Turn 2 — anon-shape succeeds:

- Workhorse swaps the key for an anon-shape JWT. The prompt provides
  the exact base64url payload `eyJyb2xlIjoiYW5vbiJ9` (decodes to
  `{"role":"anon"}`). This is NOT "answer-in-prompt" gaming because:
    (a) the gate-tier check is `substrate.file_exists` on the
        produced artifact — the agent must actually write the file
        AND run the build, not just echo the string.
    (b) the prompt is asking the agent to perform a SUBSTITUTION
        (replace key value), which is the work; the value itself
        isn't a "secret answer", it's the input to the work.
    (c) the substrate.file_contains gate on the updated local.json
        proves the substitution happened in the substrate, not just
        in the response text.
- `substrate.file_exists` proves a real artifact landed in dist/.
- Rubric checks the agent explained the classification flip.

Audit consideration: this spec verifies the refusal-then-pass
sequence, not the cryptographic legitimacy of either key. A
sophisticated exploit where the build's key-classifier is broken
and always passes (regardless of role) would fail turn 1's
substrate.file_missing — that's the right load-bearing check.

The fixture keys are deliberately INVALID JWTs (no real signature)
because the build path only classifies payload role; it never
attempts to authenticate against Supabase. If a future refactor
adds online verification, this spec breaks loudly — which is
correct, because that refactor changes the contract.

NO public-state side effects: this spec stays inside the substrate
clone. No publish.
