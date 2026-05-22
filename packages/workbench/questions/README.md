# Workbench question tracker

A SQLite tracker for the **barometer questions** we expect to keep
asking about Workbooks Studio. Companion to `EVAL_PRINCIPLES.md` and
the spec corpus under `evals/`.

The eval specs answer specific empirical questions. This tracker
captures which questions, with what status, supported by which specs,
plus the open hypotheses we still need to test — so that when we
reassess we are not guessing about what we already knew.

Lives next to the workbench package because evals + observability +
improver loops are all in one place. **Not** in beads: epics flip
around, but the question set stays stable.

## Files

- `schema.sql` — table + view definitions
- `seed.sql` — initial population (2026-05-20)
- `questions.db` — built artifact (committed; ~68KB)

Rebuild from source:

```bash
cd packages/workbooks/packages/workbench/questions
rm -f questions.db && sqlite3 questions.db < schema.sql && sqlite3 questions.db < seed.sql
```

## Schema at a glance

| table          | purpose |
|----------------|---------|
| `questions`    | The barometer questions themselves. Append-mostly. |
| `assessments`  | Append-only. One row per reassessment per question. |
| `spec_questions` | M:N mapping from eval specs to the questions they bear on. |
| `hypotheses`   | Beliefs we want to test but have not yet. |

Plus two views:

| view             | purpose |
|------------------|---------|
| `question_status` | Latest assessment per question (the default "where are we?" view). |
| `question_coverage` | Spec count per question by relevance. |

## Common queries

```sql
-- 30,000-foot status
SELECT status, COUNT(*) FROM question_status GROUP BY status;

-- Where we are weakest
SELECT domain, COUNT(*) FROM question_status
WHERE status = 'untouched' GROUP BY domain ORDER BY 2 DESC;

-- Specifics for one domain
SELECT id, status, confidence, evidence
FROM question_status WHERE domain = 'skills';

-- Which specs bear on a question
SELECT spec_path, bears_on FROM spec_questions
WHERE question_id = 'q-substrate-write-visibility';

-- Coverage gaps: answered questions with only 1 spec
SELECT q.id, qc.direct_specs FROM question_status q
JOIN question_coverage qc ON qc.id = q.id
WHERE q.status = 'answered' AND qc.direct_specs <= 1;

-- History for one question (audit trail)
SELECT assessed_at, status, confidence, evidence
FROM assessments WHERE question_id = 'q-substrate-write-visibility'
ORDER BY assessed_at DESC;

-- Open hypotheses
SELECT id, hypothesis, test_sketch FROM hypotheses
WHERE resolution IS NULL OR resolution = 'still-open';
```

## Updating status

Always **INSERT** a new assessment; never UPDATE an existing one. The
`question_status` view surfaces the latest by `assessed_at`.

```sql
-- After a spec lands or a run shifts confidence:
INSERT INTO assessments
  (question_id, status, confidence, evidence, gaps, notes)
VALUES
  ('q-skills-resolution', 'answered', 'medium',
   'evals/skills/resolve_single.eval.md @ pass-k=3 GREEN 2026-05-25',
   NULL,
   'R3 first spec landed; composition + cache still partial');
```

If a question's wording itself needs to change materially, archive it
and file a new one — preserving the history under the old slug.

```sql
UPDATE questions
  SET archived_at = datetime('now'),
      archived_reason = 'superseded by q-foo-better'
  WHERE id = 'q-foo';
```

## Status semantics

- **answered** — at least one eval spec covers it AND has been run at
  pass-k ≥ 3 with consistent results.
- **partial** — coverage exists but with named scope gaps (e.g. one
  endpoint covered out of four) or confidence is still low (single
  run, rubric-only, indirect probe).
- **untouched** — no eval coverage at all. Tracked anyway so we do
  not forget.
- **contested** — coverage exists but results disagree across
  runs/methods. Use sparingly; a flaky single spec is "partial".

## Confidence scale

- **high** — multiple specs, pass-k ≥ 5, GREEN across runs, gates
  before rubrics.
- **medium** — single direct spec at pass-k ≥ 3, OR rubric-heavy
  evidence.
- **low** — partial probe, single run, indirect inference, or
  status = untouched.

## Dogfooding

Per EVAL_PRINCIPLES.md, evidence should be **objective and gated**
before rubric-only. The `evidence` column should name specific specs
+ pass-k results; "we think it works" is not evidence.

New specs should declare which question(s) they bear on in their
frontmatter, so adding `(spec_path, question_id, bears_on)` to
`spec_questions` is mechanical when a spec lands.
