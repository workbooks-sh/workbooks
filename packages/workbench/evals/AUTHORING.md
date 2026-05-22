# Eval spec authoring conventions

Short, opinionated rules for writing `.eval.md` / `.eval.json` specs
that survive the adversarial audit pass. The full rationale lives in
[`../EVAL_PRINCIPLES.md`](../EVAL_PRINCIPLES.md); this file is the
checklist authors should keep open while editing specs.

## 1. Gates before rubrics

A failing gate skips all rubrics in the same turn. Put the objective,
falsifiable checks first; let `rubric.passes` only run once the
artifact is real.

## 2. Don't put the expected answer in the prompt

If the gate is `session.text_contains "foo"` and the prompt says
"reply with foo", an echo-only agent passes without doing anything.
Either:

- ask for a value derived from substrate state that's NOT in the
  prompt (a field, a count, a hash); or
- have the agent write to a NEW substrate path and gate on
  `substrate.file_contains` against that path.

## 3. `session.text_contains` on short literals — USE PAIRED

`DONE`, `OK`, `PINGPONG`, `yes`, `no` etc. are coordination markers,
not assertions. Always pair with a `substrate.*`, `workbook.*`, or
`session.tool_called` gate in the same turn. The substring is only
useful as a completion signal for the underlying side-effect gate.

## 4. Memory specs need distractors

A "remember X / what was X?" spec passes for a parrot that always
echoes the prompt's most recent codeword. Insert a distractor turn
between introduce-and-recall: name a different codeword in the
prompt and require the agent to reject it. Real memory wins; echo
fails.

## 5. `workbook.build` always probes by default

The action infers a DOM probe from the workbook's `type` field
(spa => `<script type="module">`, presentation => slide markers,
etc.). Authors who genuinely want a build-only check must set
`probe: false` explicitly. Otherwise an agent shipping
`<html></html>` would clear the gate.

## 6. Decoys catch blanket "yes" answers

When asking the agent to enumerate something (which paths exist,
which fields are present, which tools are available), include at
least one item that should come back negative. Gate on the negative
answer too. Pair with `session.tool_called` if the action is
inspection-shaped.

## 7. Soft-skip is for local iteration only

`auth.http_expect` and other env-dependent checks soft-skip when
their config knobs aren't set. That's intentional for fast local
loops, but **never trust a green eval that contained skips**. Run
`workbench eval --require-all` in CI / pre-release and resolve every
skip before calling the spec green.

---

If you find a way to pass a spec without doing what it claims to
test, that's an audit finding — file it as a child of `wb-xpgr.4`
with the recipe to fix.
