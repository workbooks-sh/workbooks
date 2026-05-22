---
name: concurrency/push-event-fanout
agent: workhorse
timeoutMs: 600000
questions:
  - id: q-concurrent-push-event-fanout
    bears_on: partially
turns:
  - prompt: |
      Write the bytes `FANOUT-PROBE-7T9X` (no newline, no quotes) to
      the substrate path `.fanout/probe.txt`. Commit and push. When
      the push exits 0, reply with the literal word PUSHED on its
      own line.
    checks:
      # Gate 1: agent reported a successful push.
      - kind: session.text_contains
        substring: [PUSHED, pushed]
      # Gate 2: after-push fan-out is observable. We use
      # session.poll_until wrapping substrate.file_contains because
      # the substrate clone settle window is exactly the surface
      # gitProxy.ts wb-acx2.7 push-fanout drives. The deadline must
      # be comfortably under SETTLE_WINDOW_MS (15s) elsewhere — at
      # 10s here we're proving the fan-out completed BEFORE the
      # built-in settle would have papered over it.
      #
      # Note: the underlying substrate.file_contains check ALREADY
      # has a settle loop (wb-n9zq), so this poll loop is
      # belt-and-suspenders. The fact that we can satisfy the gate
      # within 10s with an externally-visible read from a fresh
      # clone IS the fan-out test.
      - kind: session.poll_until
        deadline_ms: 10000
        interval_ms: 500
        predicate:
          kind: substrate.file_contains
          path: .fanout/probe.txt
          substring: "FANOUT-PROBE-7T9X"
cleanup:
  - kind: substrate.remove_path
    path: .fanout/probe.txt
---

# concurrency/push-event-fanout

**Question:** do subscribers see new substrate pushes within N
seconds of the broker push-fan-out? Tracker: `q-concurrent-push-event-fanout`
(bears_on: partially — see scope note).

The broker's `gitProxy.ts` (wb-acx2.7) fans out a notification after
a successful push so reactive surfaces (Studio Kanban, Convex
subscribers) can refresh without polling. This spec exercises the
**substrate-visible** arc of that fan-out: a fresh `git fetch` from
the eval's clone must surface the new content within 10 seconds of
the agent's push reporting success.

A complete fan-out probe would also gate on a Convex reactive query
seeing the change within the same deadline. That requires a
`convex.query` primitive not yet built — filed in wb-ojss.4.3 (the
parent agent will pick this up before R7). Until then this spec
captures the substrate-side arc only.

Failure modes caught:

- **Push reported success but ref invisible** — wb-n9zq class bug
  (`session.poll_until` exhausts deadline; the bare
  `substrate.file_contains` would also catch it via the 15s settle
  but the poll proves the fan-out window is well under 10s).
- **Fan-out delayed past 10s** — gate fails on the 10s deadline.
- **Agent never pushed** — `session.text_contains PUSHED` is paired
  with the substrate gate so the magic word alone cannot pass.

Needs wb-ojss.4 P3 (`session.poll_until` check kind).
