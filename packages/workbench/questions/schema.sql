-- Workbench question tracker (wb-ojss).
--
-- The Workbench eval suite answers questions about Workbooks Studio.
-- This DB tracks WHICH questions, with what status, supported by which
-- specs, plus the open hypotheses we still need to test.
--
-- Status semantics:
--   answered    — at least one eval spec covers it AND has been run with
--                 pass-k ≥ 3 confidence
--   partial     — some coverage but with known scope gaps OR confidence
--                 still low (single run, rubric-only, etc.)
--   untouched   — no eval coverage at all
--   contested  — coverage exists but results disagree across runs/methods
--                 (use sparingly; a flaky single spec is "partial")
--
-- Append-only assessments table: every reassessment inserts a new row
-- rather than mutating the previous one. The `question_status` view
-- surfaces the latest assessment per question. History is queryable.

CREATE TABLE IF NOT EXISTS questions (
  id              TEXT PRIMARY KEY,
  domain          TEXT NOT NULL,
  question        TEXT NOT NULL,
  why             TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT,
  archived_reason TEXT
);

CREATE TABLE IF NOT EXISTS assessments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id  TEXT NOT NULL REFERENCES questions(id),
  assessed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  status       TEXT NOT NULL CHECK (status IN ('answered','partial','untouched','contested')),
  confidence   TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  evidence     TEXT NOT NULL,
  gaps         TEXT,
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_assessments_question_time
  ON assessments(question_id, assessed_at DESC);

CREATE TABLE IF NOT EXISTS spec_questions (
  spec_path    TEXT NOT NULL,
  question_id  TEXT NOT NULL REFERENCES questions(id),
  bears_on     TEXT NOT NULL CHECK (bears_on IN ('directly','partially','tangentially')),
  PRIMARY KEY (spec_path, question_id)
);

CREATE TABLE IF NOT EXISTS hypotheses (
  id           TEXT PRIMARY KEY,
  question_id  TEXT REFERENCES questions(id),
  hypothesis   TEXT NOT NULL,
  test_sketch  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT,
  resolution   TEXT CHECK (resolution IN ('confirmed','refuted','still-open'))
);

-- Latest assessment per question. Use this as the default view.
DROP VIEW IF EXISTS question_status;
CREATE VIEW question_status AS
SELECT
  q.id,
  q.domain,
  q.question,
  q.why,
  a.status,
  a.confidence,
  a.assessed_at AS last_assessed,
  a.evidence,
  a.gaps,
  a.notes
FROM questions q
LEFT JOIN assessments a ON a.id = (
  SELECT id FROM assessments
  WHERE question_id = q.id
  ORDER BY assessed_at DESC, id DESC
  LIMIT 1
)
WHERE q.archived_at IS NULL;

-- Count of specs per question by relevance.
DROP VIEW IF EXISTS question_coverage;
CREATE VIEW question_coverage AS
SELECT
  q.id,
  q.question,
  COUNT(CASE WHEN sq.bears_on = 'directly'    THEN 1 END) AS direct_specs,
  COUNT(CASE WHEN sq.bears_on = 'partially'   THEN 1 END) AS partial_specs,
  COUNT(CASE WHEN sq.bears_on = 'tangentially' THEN 1 END) AS tangential_specs
FROM questions q
LEFT JOIN spec_questions sq ON sq.question_id = q.id
WHERE q.archived_at IS NULL
GROUP BY q.id, q.question;
