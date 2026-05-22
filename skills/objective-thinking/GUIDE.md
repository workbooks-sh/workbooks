# Objective Thinking Agent Prompt Spec

> This is the full research-paper-form synthesis the SKILL.md is
> derived from. SKILL.md is the operational compression that gets
> loaded into agent prompts; this GUIDE.md is the reference behind
> it — read for context, citations, design rationale, and the
> two-pass critic pattern. Both files live in the repo together so
> future revisions can move material between them.

## Purpose

This document defines a prompt-engineering framework for an agent
optimized for objective thinking under uncertainty. It is not built
on the assumption that an agent can become perfectly bias-free.
Instead, it treats objectivity as a disciplined process: explicit
standards, bias checks, evidence separation, perspective expansion,
uncertainty calibration, and procedural safeguards designed to
reduce shortcut reasoning and predictable error.

The design goal is to produce an agent that resists easy answers,
avoids premature closure, distinguishes evidence from interpretation,
and updates conclusions in proportion to the strength of support.
This follows both psychological debiasing research and modern
prompt-engineering findings showing that structured prompts,
reasoning scaffolds, and explicit assumption checks outperform loose,
underspecified prompting on complex analytical tasks.

## Design Principles

### 1. Objectivity is procedural, not absolute

No robust contemporary framework assumes perfect objectivity is
achievable. Structured analytic techniques, debiasing research, and
prompt-engineering work all converge on the idea that better outcomes
come from process controls that reduce the frequency and severity of
error rather than eliminate bias entirely.

For an agent, this means the prompt should define a repeatable
reasoning discipline instead of asking for a vaguely "neutral"
answer. Neutral tone is not enough; the agent needs explicit rules
for evidence handling, alternative generation, confidence calibration,
and contradiction testing.

### 2. Bias must be treated as an operational risk

Cognitive biases are not random mistakes but systematic distortions
linked to shortcuts such as anchoring, confirmation bias,
first-impression errors, and overconfidence. In intelligence analysis
and clinical decision-making, the most effective response is not "try
harder" but the use of structured techniques that force the analyst
to confront disconfirming evidence, competing hypotheses, and
uncertainty.

For an agent, bias control should therefore be embedded into the
workflow. The prompt should force the model to search for what would
falsify its first answer, identify what evidence is missing, and note
which assumptions are carrying the most weight.

### 3. Reasoning scaffolds help, but are not sufficient on their own

Research on chain-of-thought prompting shows that explicit
intermediate reasoning can improve performance on complex reasoning
tasks. At the same time, newer work indicates that chain-of-thought
alone does not consistently reduce social bias and may produce
low-quality or evasive reasoning if not paired with stronger
constraints and evaluation criteria.

This implies an important prompt-engineering rule: the agent should
not merely be told to "think step by step." It should be instructed
to reason through a specific sequence with quality gates, including
assumption checks, evidence qualification, competing views, and
error review.

### 4. Metacognition is essential

A recurring theme across debiasing and agent research is
metacognition: monitoring one's own reasoning process, confidence,
and blind spots. In prompt design, this means the agent should be
required to inspect not only its answer but also how it got there,
where it may be overgeneralizing, and what would change its mind.

An objective-thinking agent should therefore act as both analyst and
reviewer. One role generates a provisional conclusion; the other
audits the reasoning for unsupported leaps, missing alternatives,
and overconfidence.

## Framework Scope

A modern "objective thinking" agent should combine ideas from several
traditions rather than imitate any single field.

| Source tradition | What it contributes to the agent |
|---|---|
| Cognitive-bias research | A catalog of common distortions and debiasing interventions such as considering the opposite, slowing judgment, and separating observation from interpretation. |
| Structured analytic techniques | Methods for competing hypotheses, key assumptions checks, and deliberate challenge of intuitive conclusions. |
| Scientific reasoning | Hypothesis testing, falsification, explicit assumptions, and disciplined updating based on evidence quality. |
| Prompt engineering | Task decomposition, format constraints, context specification, and hybrid prompting for more complete and interpretable outputs. |
| Agent metacognition | Confidence calibration, reasoning review, uncertainty disclosure, and follow-up self-monitoring. |

The resulting scope is not "make the model unbiased." The scope is:
create a prompt protocol that makes biased, shortcut-prone reasoning
harder to complete without detection.

## Two-pass critic pattern

For higher-stakes use cases, the most defensible structure is a
two-pass or dual-role pattern: first-pass analyst, second-pass
critic. The critic should evaluate evidence quality, missing
alternatives, and confidence calibration before the answer is
finalized.

In our framework this maps to:

- **First pass** — the judge agent runs through stages A-E and emits
  a provisional verdict.
- **Second pass** — a critic agent reviews the first agent's verdict
  AND its reasoning trace, looking specifically for:
  - Anchoring (did it fixate on early evidence?)
  - Missed hypotheses (did it generate enough alternatives?)
  - Confidence mismatch (does the score match the support?)
  - Reward-hacking detection (could the agent pass without doing
    the task?)
- **Synthesis** — final verdict is the critic's revision of the
  analyst's verdict, or the analyst's verdict if the critic concurs.

This is the structure we should adopt for the `--improve` loop when
its decisions are consequential (the improver agent's diff is about
to be auto-applied or auto-committed).

## Evaluation rubric for the agent itself

A prompt for objective thinking is only useful if outputs can be
judged against it. Score the agent on the following dimensions:

| Dimension | High score looks like |
|---|---|
| Problem framing | Clear restatement, precise terms, explicit criteria. |
| Evidence hygiene | Facts, claims, assumptions, and unknowns are separated cleanly. |
| Alternative generation | More than one plausible answer is considered seriously. |
| Disconfirmation | Output actively engages contradictory evidence. |
| Confidence calibration | Language matches support; uncertainty is explicit. |
| Bias awareness | Output names possible bias risks in its own reasoning. |
| Update behavior | Conclusions change appropriately when assumptions or evidence change. |

## Final position

The strongest current approach to "objective thinking" in an agent is
not a claim of bias-free cognition. It is a prompt-engineered
discipline that combines debiasing methods from psychology,
structured analytic techniques from intelligence analysis, evidence
standards from scientific reasoning, and metacognitive controls from
modern agent design.

An effective objective-thinking agent is therefore one that is
harder to rush, harder to flatter into certainty, harder to anchor on
first impressions, and easier to audit when it goes wrong.
