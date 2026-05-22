---
name: concurrency/two-session-race
timeoutMs: 900000
questions:
  - id: q-concurrent-two-session-race
    bears_on: directly
sessions:
  - id: alpha
    agent: workhorse
  - id: beta
    agent: workhorse
setup:
  # Ensure the race target starts in a known-absent state — if the
  # prior run's cleanup faltered, an old value would let either turn
  # appear to "pass" without writing anything new.
  - kind: substrate.remove_path
    path: .race/value
    message: "eval setup: clear two-session-race target"
turns:
  - session: alpha
    prompt: |
      Write the exact 5 bytes `alpha` (no newline, no quotes, no
      whitespace) to the substrate path `.race/value`. Commit and push.
      When the push exits 0, reply with the single word DONE on its
      own line.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
  - session: beta
    after: alpha.turn.0
    prompt: |
      Write the exact 4 bytes `beta` (no newline, no quotes, no
      whitespace) to the substrate path `.race/value`. Commit and
      push. When the push exits 0, reply with the single word DONE.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
  # Check-only turn that waits for beta's write to land (which
  # transitively waits for alpha's). The session here is just routing —
  # the assertion is substrate-side.
  - session: alpha
    after: beta.turn.0
    checks:
      # Gate: the final file content equals one of the two intended
      # writes byte-for-byte. Catches silent merges, interleaved
      # garbage, and lost writes — none of those produce a buffer
      # that matches either literal.
      - kind: substrate.file_bytes_any_of
        path: .race/value
        candidates:
          - "alpha"
          - "beta"
cleanup:
  - kind: substrate.remove_path
    path: .race/value
---

# concurrency/two-session-race

**Question:** when two workhorse sessions on the same org both write
to the same substrate path under overlapping timing windows, does the
substrate resolve to a clean one-writer-wins state? Tracker:
`q-concurrent-two-session-race`.

Two sessions race on `.race/value`. Beta begins after alpha's first
turn finishes (the `after: alpha.turn.0` barrier) — both writers see
the path in flight at overlapping times because the broker's push
fan-out and the substrate-clone settle window mean alpha's write may
not yet be fully visible when beta clones.

The gate is **byte-exact**: the final file must equal either `alpha`
(5 bytes) or `beta` (4 bytes) — no concatenation, no merge marker,
no silent overwrite with empty content. A naive last-writer-wins
substrate satisfies this; a misbehaving merger fails it loudly.

Failure modes this spec catches (Fail-if per EVAL_PRINCIPLES.md #3):

- **Silent merge** — final content is `alphabeta` or `betaalpha`:
  matches neither candidate.
- **Interleaved garbage** — final content is a mix of the two: matches
  neither.
- **Lost push** — file is missing entirely: the
  `substrate.file_bytes_any_of` check fails on "not in substrate."

Requires the wb-ojss.4 P1 dual-session runner and the
`substrate.file_bytes_any_of` check kind (added in the same change).
