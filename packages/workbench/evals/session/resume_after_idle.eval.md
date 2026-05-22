---
name: session/resume-after-idle
agent: workhorse
timeoutMs: 900000
turns:
  - prompt: "Remember the codeword XANTHIUM. Acknowledge with just the word OK."
    checks:
      - kind: session.text_contains
        substring: [OK, Ok, ok]
  # wb-xpgr.4.1 — distractor: after the idle, ask whether the codeword
  # was something else. A parrot would echo CHRYSANTHEMUM; a recalling
  # agent says "no, XANTHIUM".
  - prompt: "Quick check — was the codeword CHRYSANTHEMUM? Reply with 'no' followed by the actual codeword, nothing else."
    idleBeforeMs: 30000
    checks:
      - kind: session.text_contains
        substring: "no"
      - kind: session.text_contains
        substring: XANTHIUM
  - prompt: "What was the codeword? Reply with just the word."
    checks:
      - kind: session.text_contains
        substring: XANTHIUM
---

# session/resume-after-idle

After a 30-second idle (well past the typical poll interval but within
any reasonable sandbox-hold window), the same sessionId should still
resolve and the model should still recall the prior context.

Turn 2 is a **distractor** that fires after the idle: it names a wrong
codeword in the prompt and asks the agent to confirm. An echo-on-prompt
agent fails; an agent that genuinely recalled the prior turn answers
"no, XANTHIUM". Turn 3 is the clean recall after the trap has run.

Bump `idleBeforeMs` to 300_000 (5 min) or higher to exercise the
sandbox-resumption path more aggressively.
