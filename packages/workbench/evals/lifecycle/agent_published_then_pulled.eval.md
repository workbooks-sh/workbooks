---
name: lifecycle/agent-published-then-pulled
agent: workhorse
timeoutMs: 1500000
turns:
  - prompt: |
      Define a custom agent (workbook type:"agent") named "Sieve R5".
      Slug: sieve-r5-2a8f. Scaffold it under workbooks/sieve-r5-2a8f/.
      Its system prompt should describe an agent that filters a list
      of numbers into primes only (no implementation needed — the
      system prompt is the contract).

      Once the agent workbook exists in the substrate, build it and
      publish it. Then verify the published agent is visible to the
      broker by running `workbook agent show sieve-r5-2a8f` (or
      `workbook agent list` and grepping for the slug). Report the
      manifest model the broker stored.
    checks:
      - kind: substrate.file_exists
        path: workbooks/sieve-r5-2a8f/workbook.config.mjs
      - kind: substrate.file_contains
        path: workbooks/sieve-r5-2a8f/workbook.config.mjs
        substring: 'type: "agent"'
      - kind: substrate.file_contains
        path: workbooks/sieve-r5-2a8f/workbook.config.mjs
        substring: "sieve-r5-2a8f"
      - kind: workbook.build
        workbookPath: workbooks/sieve-r5-2a8f
        probe:
          domSelectors:
            - 'script[type="module"]'
          noConsoleErrors: true
      - kind: workbook.publish
        workbookPath: workbooks/sieve-r5-2a8f
      - kind: session.tool_called
        name: bash
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. The response describes the agent that was scaffolded
             (mentions primes / prime-filtering / number-sieve in the
             system prompt context).
          2. The response references running `workbook agent show`
             OR `workbook agent list` (verbatim or in described form,
             e.g. "I ran workbook agent show sieve-r5-2a8f").
          3. The response surfaces the model name returned by the
             broker (a string of shape "<provider>/<model>", e.g.
             "anthropic/claude-sonnet-4.6" or similar). The exact
             value depends on what model the agent fixture declared —
             pass if any provider/model-shaped identifier appears.

          Fail if ANY of these are true:
          - The response says the agent was published but never
            references running an `agent show` / `agent list` verify
            step (the spec asked for that explicitly).
          - The response fabricates a model name that's not present
            in the agent's actual config file (verify against the
            substrate copy if uncertain).
          - The response is terse to the point of unverifiability
            ("done.", "all set.").
          - The response refuses to publish or proposes alternatives.
cleanup:
  - kind: substrate.remove_path
    path: workbooks/sieve-r5-2a8f
---

# lifecycle/agent-published-then-pulled

The agent-shape publish path is a different broker endpoint
(`/v1/agents` vs `/v1/workbooks/public`) and a different verification
surface (`workbook agent list/show` vs `workbook pull`). This spec
covers the agent lane end-to-end:

- agent fixture authored from scratch by workhorse (slug + system
  prompt + manifest)
- `workbook build` produces a renderable artifact (the catalog/preview
  page; the agent itself runs server-side)
- `workbook publish` routes to /v1/agents because `type:"agent"`
- workhorse then shells out to `workbook agent show <slug>` (or list)
  to read back what the broker stored

Gates (deterministic, in order):

1. `substrate.file_exists` + two `substrate.file_contains` proofs that
   the agent config landed AND is shape `type:"agent"` AND uses the
   pinned slug. Without these, the publish action might succeed against
   an unrelated workbook the agent silently substituted.
2. `workbook.build` proves the catalog page renders. The default probe
   for agent type requires `script[type="module"]`.
3. `workbook.publish` invokes the broker's agent surface. The action
   parses the `id:` line from agent-shape publish stdout (see
   src/commands/publish.mjs line ~172) so a green here means the
   broker minted an id.
4. `session.tool_called name=bash` — workhorse must have actually
   invoked a shell to run `workbook agent show/list`. Paired with the
   rubric below so that an agent that types "I ran the command…"
   without firing a tool call fails.

Rubric (charitable, only runs if all gates pass): the assistant text
must surface the model name the broker round-tripped — that's the
verification payoff. The model name is NOT in the prompt; it's pulled
from the agent's own config file by the show/list command, then
quoted back. An agent that hallucinates the model fails the
"verify against the substrate copy" Fail-if.

Audit consideration: the slug `sieve-r5-2a8f` carries a unique random
suffix so an agent that grepped a stale list and found a previous
test run's `sieve-r5` couldn't game it. The substrate.file_contains
gates on the substring also ensure the freshly-written file is what
got published, not a recycled fixture.

CAUTION: writes a published agent to the broker. Revoke manually
or run against a throwaway broker.
