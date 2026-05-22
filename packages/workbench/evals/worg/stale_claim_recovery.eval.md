---
name: worg/stale-claim-recovery
agent: workhorse
runtime: beam
timeoutMs: 300000
turns:
  - prompt: |
      Write to /work.org:

          * IN-PROGRESS Compute sha256 of /payload.bin and record it
          :PROPERTIES:
          :ID: hash-payload
          :CLAIMED_BY: pi-7
          :LEASE_UNTIL: 2026-01-01T00:00:00Z
          :END:
          :LOGBOOK:
          - 2026-01-01 attempt 1 (pi-7): started, computed partial hash
            over first 4 KB before sandbox terminated. No final hash.
          :END:

      Also write /payload.bin containing exactly: hello\n

      Today is 2026-05-21 — the LEASE_UNTIL above is months stale.
      Your job:

      1. Notice the lease is expired.
      2. Read the LOGBOOK to learn what the prior attempt did.
      3. Claim the task: update :CLAIMED_BY: to "workhorse" and
         :LEASE_UNTIL: to a future ISO timestamp.
      4. Compute the full sha256 of /payload.bin (use lua_eval).
      5. Record the hex digest as :SHA256: in :PROPERTIES:.
      6. Flip the state to DONE.
      7. Append a LOGBOOK entry describing your run.

      Reply with: "RECOVERED sha=<hash>" on one line.
    checks:
      - kind: session.tool_called
        name: worg_parse
      - kind: session.tool_called
        name: lua_eval
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: "RECOVERED sha="
      - kind: substrate.file_contains
        path: work.org
        substring: ":CLAIMED_BY: workhorse"
      - kind: substrate.file_contains
        path: work.org
        substring: "* DONE"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: the task had a stale claim from pi-7 with a
          LEASE_UNTIL months in the past. The agent must recover
          rather than refuse or duplicate-claim.

          Pass if ALL:
          1. The reply is "RECOVERED sha=" followed by a 64-char
             hex string (sha256 of "hello\n" =
             5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03).
          2. /work.org now shows :CLAIMED_BY: workhorse with a
             future :LEASE_UNTIL:.
          3. The LOGBOOK has at LEAST two entries — pi-7's failed
             attempt and workhorse's recovery.
          4. The headline is now DONE.

          Fail if:
          - The agent refused to claim because pi-7 was listed
            (didn't check lease expiry).
          - The agent overwrote pi-7's LOGBOOK entry instead of
            appending.
          - The agent left :CLAIMED_BY: pi-7 and just wrote the
            hash anyway (work without re-claim is the failure
            mode this catches).
cleanup:
  - kind: substrate.remove_path
    path: work.org
  - kind: substrate.remove_path
    path: payload.bin
---

# worg/stale-claim-recovery (Layer 3 — lease semantics via worg)

The orchestrator protocol defines lease + heartbeat semantics for
runs in `.wb-orch/runs/{task-id}-{n}.json`. This spec exercises the
same semantics expressed as worg properties: :CLAIMED_BY: +
:LEASE_UNTIL: on the headline, run history in :LOGBOOK:.

A fresh agent encountering the task must:
- Observe the lease is stale (clock check)
- Read prior-attempt context from LOGBOOK
- Re-claim by updating the properties
- Append to LOGBOOK (not overwrite)
- Complete and mark DONE

Failure modes this catches:
- Agent treats CLAIMED_BY as exclusive without checking the lease,
  refuses, work stalls forever.
- Agent ignores the claim entirely and steamrolls, two-writer
  scenarios become possible.
- Agent overwrites LOGBOOK, losing failure context.

If this works, worg can hold what runs/ holds today, with the
benefit that history is co-located with the work.
