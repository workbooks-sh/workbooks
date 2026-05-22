# worg/ — agent-native planning substrate eval suite

These 23 specs validate worg (`.org` files as the agent context
substrate) end-to-end through the BEAM runtime. They map to the
Linear-thesis argument that ticket trackers were built for handoffs
and need to be replaced by a context-as-execution surface — except
the substrate here is org-mode, parsed by a Rust NIF, persisted to
Postgres atomically.

All specs are **BEAM-runnable** (no broker, no CLI, no Studio
required). Run individually with:

```
mix wb.eval.run --runtime beam packages/workbooks/packages/workbench/evals/worg/<spec>.eval.md
```

Or the whole category:

```
mix wb.eval.run --runtime beam packages/workbooks/packages/workbench/evals/worg
```

## Three layers

### Layer 1 — Capability gates (8 specs, deterministic)

Each spec exercises one worg primitive end-to-end. Gate-only —
failures should be tool wiring bugs, not LLM-behavior issues.

- `parse_basic` — `worg_parse` returns structured state info
- `query_by_state` — find by TODO state
- `query_by_property` — find by `:ID:` / custom property
- `mutate_transition` — TODO → DONE roundtrip
- `mutate_create_headline` — add child headline (composability)
- `mutate_properties` — add/update arbitrary properties (extensibility)
- `source_block_extract` — read `#+BEGIN_SRC ... #+END_SRC`, dispatch
  to the right runtime
- `drawer_logbook` — append to `:LOGBOOK:` drawer without breaking
  structure

### Layer 2 — Prompt-shape variants (3 specs, rubric-judged)

Tests whether worg is the **reflexive** answer when the user asks
implicit planning questions. No tool names in the prompts.

- `find_next_implicit` — "what should I work on next?"
- `decompose_implicit` — "help me break this down"
- `mark_progress_implicit` — "I just finished X"

### Layer 3 — Context-as-execution loops (12 specs, the real test)

These prove the Linear-thesis claim: that the .org file IS the
substrate, not a thin abstraction over a ticket queue. Split into
three sub-thrusts.

**Core loop (5 specs):**

- `intent_to_execution` — `:SUCCESS_CRITERIA:` + `:CONSTRAINTS:`
  drive execution; agent self-verifies
- `source_block_loop` — plan-as-program; agent dispatches each
  headline's source block to the right runtime
- `multi_step_plan` — the drift test; agent returns to plan after
  each step and picks up the next
- `decision_context_honored` — `:NOTES:` drawer carries prior
  decisions; agent honors them (the Pathmode critique made concrete)
- `two_agent_via_states` — handoff through shared substrate;
  Workhorse grafts work, specialist completes via worg_mutate, no
  intermediate ticket system

**Planning extensions (3 specs):** worg as a *living* plan that
absorbs drift and decision lifecycle, not just a write-once record.

- `constraint_drift_surfaced` — agent's work would violate a
  `:CONSTRAINTS:` line; correct behavior is to STOP + amend the
  plan via :LOGBOOK:, not push through silently
- `decision_revoked` — :NOTES: has temporal layering ("decided X"
  then "revoked X, use Y"); agent honors the latest, not the first
- `plan_amendment` — agent detects mutually-incompatible
  constraints, writes an `:AMENDMENT:` drawer proposing which to
  relax, leaves the headline at NEXT for human confirmation

**Orchestration via worg (4 specs):** worg as a substitute for the
orchestrator protocol's `.wb-orch/tasks/{id}.json` store.

- `orchestrator_dag_walk` — multi-level :PARENT: chain; agent
  walks up to find root-goal context, records decision in own
  headline's properties (parallels orchestrator §4.2 / §6.5)
- `stale_claim_recovery` — task has :CLAIMED_BY: + expired
  :LEASE_UNTIL:; fresh agent recovers, re-claims, appends to
  :LOGBOOK: (parallels protocol §6.3 lease semantics)
- `capability_gate` — headlines tagged with :CAPABILITIES:;
  agent claims those it can satisfy, moves the rest to WAITING
  with a missing-capability LOGBOOK note (parallels §6.2)
- `plan_as_prompt` — the thesis-test: agent's user message is
  literally `/plan.org`. No instructions. Agent reads the file,
  identifies NEXT headlines, executes, marks DONE. If this passes,
  worg actually IS the planning substrate, not a config the user
  has to narrate around

## What this suite is for

Workbooks ships worg as the planning + context surface that agents
read and write. These specs are the regression suite — when a worg
primitive (parse / query / mutate, source blocks, drawers,
properties) regresses, exactly one Layer 1 spec breaks. When agent
behavior degrades around using worg reflexively, Layer 2 catches it.
Layer 3 catches the most important class of failures: the agent
treats worg as a write-only log instead of a living plan.
