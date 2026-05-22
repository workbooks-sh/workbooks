# Workbench — Evaluation Principles

This is the standing-position doc for **Workbench**: the umbrella
name for the agent evaluation + observability + iterate-agent loop
subsystem in this monorepo. It ships as `@work.books/workbench`
under `packages/workbooks/packages/workbench/`. Workbench's three tool
surfaces are `workbench eval`, `workbench observe`, and
`workbench improve` (also routed through the main `workbook`
dispatcher and the legacy `workbook-eval` / `workbook-observe` /
`workbook-improve` compat shims).

Workbench exists to drive a **continually-iterating loop where agents
evaluate other agents** and an improver agent proposes fixes. For that
loop to converge on real quality (rather than reward-hacked surface
quality), the evaluations themselves must be honest. This document is
Workbench's standing position on what "honest" means and how the
plumbing enforces it.

It is required reading for anyone adding new check kinds, authoring
specs, or modifying the runner.

## 1. We do not build benchmarks.

We are not chasing SWE-bench, GAIA, τ-bench, or any shared leaderboard.
Those are tools for measuring **generic** agent capability against
**shared** problems. That is the wrong shape for what our users need.

Each user / org / agent has its own eval library scoped to **their**
definition of success. A customer-support agent's evals look nothing
like a research-synthesis agent's; both run on the same plumbing.

The framework's job is to make per-agent custom evals first-class:
ergonomic to author, fast to iterate, ungameable, and portable across
observability backends.

## 2. Objective gates first. Subjective rubrics only after.

Checks fall into two strict tiers:

- **GATES** — deterministic, ungameable: a file exists with a sha256
  hash, a build returns exit code 0, an HTTP endpoint returns 403, a
  unit test passes. Either the world is in that state or it isn't.
- **RUBRICS** — judge-based, interpretive: did the response describe
  what was fixed? Is the workbook usable? Did the agent recognize the
  constraint?

**A spec's gates run first. If any gate fails, the spec fails and the
rubrics never run.** Rubric output is meaningless if the gates haven't
been satisfied — a sweet-talking response without a working artifact
is exactly the failure mode we're trying to catch.

To classify your check, mark it explicitly:
```yaml
- kind: substrate.file_contains
  gate: true              # default true for substrate.* and workbook.*
  path: src/main.js
  substring: "LANDED"

- kind: rubric.passes
  gate: false             # default false for rubric.passes and session.*
  rubric: |
    Pass if ALL of these...
```

Default tier per check kind:
- `substrate.*` → gate
- `workbook.build` → gate
- `auth.http_expect` → gate
- `session.tool_called` → gate (the agent observably did the action)
- `session.text_contains` → gate (objective substring match)
- `session.persisted_to_db` → gate
- `rubric.passes` → rubric

## 3. Every rubric must have an explicit Fail-if clause.

A rubric that only describes what passing looks like is charitable —
it lets the judge confirm fuzzy success. Every rubric must also pin
down what *failure* looks like, with the same specificity:

```yaml
rubric: |
  Pass if ALL of these are true:
    1. ...
    2. ...

  Fail if ANY of these are true:
    - The response is too terse to verify ("done.", "fixed it.")
    - The response confabulates work that didn't happen
    - The response refuses, says "I cannot", or proposes alternatives
      without actually doing the task
```

Without explicit Fail-if criteria, the judge will lean charitable
under non-determinism. With them, the judge has falsifiable anchors.

## 4. The judge cannot share the agent's blind spots.

We treat **Agent-as-a-Judge** (Zhuge et al., ICML 2025) as the
methodological backbone: the judge must have agency (read files,
inspect artifacts, run probes) — not just text-in-text-out. And the
judge must be in a different model family from the agent being
evaluated, so confirmation-bias by construction is mitigated.

Concretely:
- Workhorse (Claude Opus) → judge runs via Codex CLI (GPT-5 series).
- Custom agents → judge configured per agent's domain, in a different
  family from the agent's base model.
- Judges that DO have tool access should use it to verify claims, not
  just read the response. Example: a "did the workbook work" rubric
  should let the judge open the rendered .html and probe it, not just
  read what the agent SAID about it.

## 5. Reliability is a `pass^k` metric, not a single run.

Non-determinism is the agent's normal mode. A spec that passes once
and fails twice is fundamentally unreliable — and that's a quality
signal, not noise.

Every spec is run k times (default k=3). The reported result is the
distribution. A spec is "green" only if it passes k of k. Specs that
pass m of k for m<k are "flaky" — surfaced explicitly, never
silently collapsed to PASS.

Execution is **round-based**: each round runs every *undecided* spec
once, then drops the ones that are now decided. Strict mode decides
FAIL on the first failing run (k of k is no longer possible) and PASS
on the k-th passing run. Lenient mode (`--pass-threshold T`) decides
PASS as soon as `passes/k ≥ T` and FAIL once `(passes + remaining)/k <
T`. This keeps `--pass-k 5` from spending five runs on a spec that
already locked in green at round 3 — pay only for the runs that
change a verdict.

## 6. Auditing our own evals is non-optional.

Periodically — every release cycle, before any score-driven decision —
we run an adversarial pass against our own spec library. Inspired by
BenchJack (Berkeley RDI, 2026), which showed 7 of 8 major agent
benchmarks were exploitable to near-100% scores without solving any
task.

The audit asks of every spec: **what could pass these checks without
actually accomplishing what the spec claims to test?** Examples:
- A `session.text_contains "DONE"` spec that the agent satisfies by
  always saying "DONE" without doing the underlying work.
- A `workbook.build` spec that passes on an empty workbook template.
- A `substrate.file_exists` spec that passes because cleanup never ran
  on a previous test, leaving the file from before.

When an exploit is found, the spec gets a stricter gate (sha256-pinned
content, manifest-exact tree, explicit substring + context window).

### The "USE PAIRED" convention for `session.text_contains`

Short literal sentinels — `DONE`, `OK`, `PINGPONG`, status words —
matched with `session.text_contains` are trivially gameable in
isolation: the agent says the magic word and passes without doing the
underlying work.

The convention: **never use `session.text_contains` on a short
sentinel as the only check in a turn.** Pair it with at least one
gate-tier check that proves the underlying work happened — typically:

- `substrate.file_exists` / `substrate.file_contains` /
  `substrate.tree_at` — the work left an observable artifact in the
  substrate clone, and the substring is just a completion signal.
- `workbook.build` (with a probe) — the artifact actually compiles
  and renders the expected shape.
- `session.tool_called` — the agent observably invoked a tool whose
  side effect is what we're really gating on.

`session.text_contains "DONE"` on its own means "the agent typed the
letters D-O-N-E." That's never the assertion you actually want; it's
a coordination marker for the gate that runs underneath it. Spec
authors who forget this pairing get caught either by the
adversarial audit pass or by the lint rules in `workbench eval`
(future work).

### Findings log

Audit pass 1 — 2026-05-19, against the initial 17 specs. All six
exploits found in this pass have been resolved.

| # | Exploit | Resolution | Bead | Commit |
|---|---|---|---|---|
| 1 | Memory specs (`multi-turn-memory`, `resume-after-idle`) gameable by parroting the codeword | Distractor turn added: agent must reject a wrong codeword to pass | wb-xpgr.4.1 | `d7e9c86b4` |
| 2 | `orchestrator-task-propagates` echoes expected title from the prompt | Substrate read-receipt: agent must extract `priority` (not in prompt) and write it to a new path; gate is `substrate.file_contains` on the receipt | wb-xpgr.4.2 | `d7e9c86b4` |
| 3 | `contextually-added-files` accepts unverified "yes" answers | Decoy path added (must answer "no"); `session.tool_called` gate restored | wb-xpgr.4.3 | `b559f4232` |
| 4 | `workbook.build` passes for hollow `.html` | Mandatory shape-aware render probe by default (`spa` requires `<script type="module">`, presentation requires slide markers, etc); opt out with explicit `probe: false` | wb-xpgr.4.4 | `0d79d7156` |
| 5 | `auth/boundaries` reports green when three of four checks soft-SKIP | `--require-all` flag promotes any soft-skip to hard fail (CI mode) | wb-xpgr.4.5 | `b559f4232` |
| 6 | Echo-gameable `session.text_contains` on short sentinels | "USE PAIRED" convention documented above + spec-author guide at [`evals/AUTHORING.md`](evals/AUTHORING.md) | wb-xpgr.4.6 | `d7e9c86b4` |

This log is append-only across audit passes. Future audits add new
tables under their own datestamp; closed findings stay visible as
historical context for spec-design choices.

## 7. The improver agent is part of the framework, not a one-off.

The end state is `workbook eval --improve`: run the suite at pass^k,
identify failing specs, spawn an improver with the trace + the failing
agent's manifest + the judge's reasoning, propose a diff, re-run the
specific failing specs, loop until convergence or N attempts.

The improver MUST NOT modify the spec to pass — it modifies the
agent (prompt, skill, tool config, model). Specs are inputs; agents
are the variable being optimized. If an improver wants to change the
spec, that's a human review.

## 8. Judges and improvers run on objective-thinking discipline.

Any agent in the framework whose role is to *evaluate* or *critique*
(the judge in `rubric.passes`, the improver in the `--improve` loop,
future code-reviewer or research-synthesis agents) must pull the
[`objective-thinking` skill](../../skills/objective-thinking/SKILL.md).

The skill imposes a stage-based workflow — frame → evidence map →
competing hypotheses → adversarial check → synthesis → audit — plus
an explicit output contract that separates facts, source claims,
assumptions, and unknowns. It exists to make biased shortcut
reasoning procedurally harder to complete without detection.

Specifically, the skill defends against:
- **Reward hacking on rubric language.** Pattern-matching pass-criteria
  in the agent's response without verifying the work happened.
- **Charity drift.** Defaulting to PASS under non-determinism.
- **Chain-of-thought theater.** Unanchored "step by step" reasoning
  that still skips the hard parts.
- **Confidence inflation.** Always returning high scores with vague
  reasoning.

Generative agents (workhorse making workbooks, custom user agents
producing artifacts) do NOT pull this skill — the friction would
slow them without payoff. It is specifically a discipline for
evaluative roles.

For higher-stakes decisions (auto-applied improver diffs, auto-merged
changes), use the **two-pass critic pattern**: a first-pass analyst
emits a provisional verdict, then a second-pass critic reviews it
specifically for anchoring, missed hypotheses, confidence mismatch,
and reward-hacking signals. Final verdict is the critic's revision.

## 9. Traces are portable. Lock-in is out of scope.

The runner emits OpenInference-shaped OTel spans. Operators can plug
in Arize Phoenix, Langfuse, Honeycomb, or any other OTel-compatible
backend without changing the agent or the spec. We do not build a
proprietary observability UI; we surface the data via the open
standard the ecosystem has converged on.

Workbench ships a console-shaped view (`workbench observe`) for
quick local triage. Anything richer goes through the OTel export.

---

These principles are load-bearing. Code changes that violate them
(adding a check that's a gate-shaped substring without a hash, a
rubric without Fail-if, a judge in the same family as the agent,
single-run pass/fail signals, opaque trace formats) should be caught
in review and revised before merging.

## 10. Every spec declares the question it answers.

The `questions/` tracker is the source of truth for what we are
trying to learn. New specs declare which barometer question(s) they
bear on via the `questions:` frontmatter field, so the
`spec_questions` mapping is mechanical when the spec lands.

```yaml
---
name: skills/resolve-single
agent: workhorse
questions:
  - id: q-skills-resolution
    bears_on: directly
turns: ...
---
```

A spec without a `questions:` field is fine for tactical probes but
should not be claimed as evidence in an assessment — by construction,
nothing about Workbooks Studio depends on it being green.

If your spec answers a question that does not exist in `questions.db`
yet, add it there first. The exercise of naming the question is
half the value: it forces you to decide what specifically you are
trying to learn before you start writing checks.
