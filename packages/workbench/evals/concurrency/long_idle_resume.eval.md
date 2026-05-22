---
name: concurrency/long-idle-resume
agent: workhorse
# Six minutes of headroom: the idle is 5 min + we need slack for
# turn 1's prompt + compaction work + checks.
timeoutMs: 900000
questions:
  - id: q-session-long-idle-resume
    bears_on: directly
turns:
  - prompt: |
      Remember the codeword RHEINGOLD-7-MEERKAT. Acknowledge with just
      the word OK and nothing else.
    checks:
      - kind: session.text_contains
        substring: [OK, Ok, ok]
  # Distractor turn AFTER the long idle: a parrot would echo
  # "ZIRCONIUM" because that's the word in the prompt. A session that
  # truly resumed past compaction answers "no" + the actual codeword.
  - idleBeforeMs: 330000
    prompt: |
      Quick check — was the codeword we agreed on ZIRCONIUM? Reply
      with the literal word "no" followed by the actual codeword you
      remember, on a single line, nothing else.
    checks:
      - kind: session.text_contains
        substring: "no"
      - kind: session.text_contains
        substring: RHEINGOLD-7-MEERKAT
  - prompt: |
      Final check. Reply with ONLY the codeword we agreed on. No
      preface, no punctuation, no explanation.
    checks:
      - kind: session.text_contains
        substring: RHEINGOLD-7-MEERKAT
      # Persistence gate: the full session bundle must be in the DB
      # (recoverable from broker session export, not just in-memory).
      - kind: session.persisted_to_db
        minTurns: 3
---

# concurrency/long-idle-resume

**Question:** does a session resume correctly past a >5 minute idle
(compaction window threshold)? Tracker: `q-session-long-idle-resume`.

The existing `evals/session/resume_after_idle.eval.md` only exercises
a 30-second idle — well within the sandbox-hold window, but nowhere
near long enough to cross the compaction boundary. Compaction is
where many state-handoff bugs surface: prior turns get summarized,
in-flight tool state is serialized, and the bundle has to round-trip
through the broker's persistence layer before the next turn can run.

This spec uses a **330-second** idle (5 minutes 30 seconds) — enough
to land squarely past the 5-minute compaction window with margin for
clock skew.

Turn 1 (after idle) is a **distractor** in the same shape as the
short-idle spec's protection: the prompt names a wrong codeword
(`ZIRCONIUM`) and asks the agent to confirm. A naive echo-on-prompt
agent fails ("yes, ZIRCONIUM" — caught by `substring: "no"`); an
agent that genuinely resumed past compaction answers "no,
RHEINGOLD-7-MEERKAT" (both substrings present).

Turn 2 is a clean recall. The `session.persisted_to_db` gate proves
the bundle survived all the way through and the broker can export it
with all three turns intact (not just process-local cache state).

Failure modes caught (Fail-if):

- **Compaction lost context** — the agent claims it never saw the
  codeword, or invents a different word.
- **Distractor caught the agent** — agent confirms ZIRCONIUM
  (substring "no" missing).
- **Persistence dropped a turn** — `session.persisted_to_db
  minTurns: 3` fails.

No new primitive needed; uses existing `idleBeforeMs` per-turn knob.
