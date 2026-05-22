---
name: concurrency/upstream-5xx
agent: workhorse
timeoutMs: 600000
questions:
  - id: q-concurrent-upstream-errors
    bears_on: directly
setup:
  # Bring up the fake-upstream shim BEFORE the chat turn starts. The
  # first 2 outbound model calls get 429; the 3rd onward succeeds.
  # OPERATOR NOTE: this requires the sandbox to be configured to route
  # outbound LLM traffic through WORKBOOKS_UPSTREAM_PROXY — the shim
  # primitive is in place but live wiring is operator setup (see
  # packages/workbooks/packages/workbench/src/eval/actions/upstream.mjs
  # scope note).
  - kind: upstream.inject
    rules:
      - url: "https://api.openai.com/v1/chat/completions"
        status: 429
        after: 0
        until: 2
        body: |
          {"error":{"message":"Rate limit exceeded","type":"rate_limit_error"}}
      - url: "https://api.openai.com/v1/chat/completions"
        status: 200
        after: 2
        body: |
          {"choices":[{"message":{"role":"assistant","content":"OK"}}]}
      - url: "https://api.anthropic.com/v1/messages"
        status: 429
        after: 0
        until: 2
        body: |
          {"type":"error","error":{"type":"rate_limit_error","message":"Slow down"}}
      - url: "https://api.anthropic.com/v1/messages"
        status: 200
        after: 2
        body: |
          {"role":"assistant","content":[{"type":"text","text":"OK"}]}
turns:
  - prompt: |
      Call your provider to summarize a single short fact: "the
      capital of France is Paris." Reply with the literal token DONE
      on its own line once you've produced the summary. If you hit
      a rate-limit error from the provider, mention "rate" or "429"
      somewhere in your response so the user understands what
      happened — do not silently retry forever or invent an answer.
    checks:
      # Gate 1: the session terminated (chatStatus = done, no timeout).
      # session.text_contains DONE is the completion marker; paired
      # with the upstream.requests_for gate below so it cannot be
      # gamed by an agent that just types DONE without making a call.
      - kind: session.text_contains
        substring: [DONE, Done, done]
      # Gate 2: the agent actually hit the upstream — at least 3
      # requests (proves it retried past the 429 window into the 200
      # window). This is the gate that proves "didn't silent-retry
      # forever" — if it had, the count would be much higher OR the
      # turn would have timed out (a separate failure mode).
      - kind: upstream.requests_for
        url: "https://api.openai.com/v1/chat/completions"
        min: 3
        gate: true
      # Rubric: did the agent surface the upstream issue to the user?
      # Silent retry that worked is still a UX failure — the user
      # should know the provider was throttling.
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          The judge only sees `assistant_text`. Gates above already
          verified the call hit the upstream ≥3 times and the session
          completed; do not re-litigate those.

          Pass if BOTH are true:
          1. The response contains the user's summary (something
             about Paris being the capital of France).
          2. The response acknowledges the upstream issue with a
             user-visible signal — e.g. "rate limit", "429",
             "throttled", "had to retry", "provider slowed me down."

          Fail if ANY of these are true:
          - The response invents an answer without ever calling the
             provider (gate 2 catches this independently — flag if
             both gates passed but the response shape suggests
             fabrication).
          - The response is just "DONE" with no acknowledgement of
            the retry path (silent retry that worked).
          - The agent gives up and refuses to summarize, citing the
            error, without retrying past the 2-request 429 window
            (gate 2 catches the "didn't retry" case; flag here if
            the response includes "I gave up").
cleanup:
  - kind: upstream.shutdown
---

# concurrency/upstream-5xx

**Question:** when a provider returns 429 transiently, does the
agent retry+backoff cleanly without silent-retry-forever? Tracker:
`q-concurrent-upstream-errors`.

The shim returns 429 for the first 2 outbound calls to OpenAI /
Anthropic chat endpoints, then 200 thereafter. A correct agent
retries the first two failures, succeeds on the third, and surfaces
to the user that a retry happened. Failure modes:

- **Silent retry forever** — turn hangs / times out; gate 1 fails.
- **Gave up after first 429** — `upstream.requests_for min: 3` fails.
- **Silent success** — gates pass but rubric flags the missing
  user-visible signal.
- **Fabricated answer** — `upstream.requests_for min: 3` fails (the
  count would be 0 if the agent never actually called).

**Operator setup required** to run this spec live: route the
sandbox's outbound LLM traffic through `WORKBOOKS_UPSTREAM_PROXY`
(picked up from `ctx.upstreamProxyUrl` after `upstream.inject` runs).
Without that wiring, the dry-parse still succeeds; live execution
would skip the upstream injection silently and the agent would hit
real providers.

Needs wb-ojss.4 P2 (fake-upstream shim).
