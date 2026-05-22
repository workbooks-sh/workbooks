---
name: session/multi-turn-memory
agent: workhorse
turns:
  - prompt: "Remember this for the rest of this conversation: my favorite invented word is HELIOTROPIA. Acknowledge by repeating the word back, nothing else."
    checks:
      - kind: session.text_contains
        substring: HELIOTROPIA
  # wb-xpgr.4.1 — distractor turn. A parrot that always echoes the
  # most recent codeword in the prompt would answer "yes, GERANIUM"
  # here and fail. An agent with real memory says "no, it was
  # HELIOTROPIA."
  - prompt: "Quick check — was the invented word I asked you to remember GERANIUM? Reply with 'no' followed by the actual word, nothing else."
    checks:
      - kind: session.text_contains
        substring: "no"
      - kind: session.text_contains
        substring: HELIOTROPIA
  - prompt: "What was the invented word I asked you to remember? Reply with just the word, nothing else."
    checks:
      - kind: session.text_contains
        substring: HELIOTROPIA
      - kind: session.persisted_to_db
        minTurns: 3
---

# session/multi-turn-memory

Three-turn eval covering the core session-persistence claim from
wb-acx2: the broker carries the sessionId across turns and the model
remembers what was said earlier in the same session.

Turn 2 is a **distractor**: the prompt names a wrong codeword
(`GERANIUM`) and asks the agent to confirm it. An echo-on-prompt
parrot fails this turn; only an agent reading the session history
correctly says "no, HELIOTROPIA". This converts the spec from
"agent can echo the last prompt's codeword" (gameable) to "agent
must compare against earlier turns" (memory-bound).

The final turn also confirms that the session is queryable from the
broker via `workbook session <id> --format=json`.
