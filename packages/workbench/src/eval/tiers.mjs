// Check tiers — EVAL_PRINCIPLES.md #2.
//
// Every check has a tier:
//   - GATE     deterministic, ungameable (file exists with sha256,
//              build returns 0, HTTP returns 403). Runs first.
//   - RUBRIC   judge-based, interpretive. Runs only after all gates
//              pass. A failing gate skips all rubrics in the same
//              turn — a sweet-talking response with a missing
//              artifact must not count as a pass.
//
// Spec authors can override per-check by setting `gate: true | false`
// on the check. The defaults below capture the intent of each check
// kind: anything that can be deterministically observed in state is
// a gate; anything that interprets prose is a rubric.

const DEFAULT_GATE_KINDS = new Set([
  // substrate — observable state on the git substrate
  "substrate.file_exists",
  "substrate.file_missing",
  "substrate.file_contains",
  "substrate.file_bytes_match",
  "substrate.file_bytes_any_of",
  "substrate.bytes_equal",
  "substrate.tree_at",
  "substrate.gitignored",
  // workbook — build/render/lifecycle pipeline
  "workbook.build",
  "workbook.publish",
  "workbook.pull",
  // mcp — invoke a tool on a published workbook
  "mcp.call",
  // auth — HTTP boundary checks; status code is deterministic
  "auth.http_expect",
  // session — observable from the event stream
  "session.tool_called",
  "session.text_contains",
  "session.persisted_to_db",
  // wb-ojss.4 P3 — eventually-true assertion; the underlying predicate
  // is itself a check whose tier classification governs interpretation.
  "session.poll_until",
  // upstream — wb-ojss.4 P2 — fake-upstream shim observability
  "upstream.requests_for",
  // wavelet — programmatic probes against video output, traces, and workflow state
  "wavelet.video_renders",
  "wavelet.cost_below",
  "wavelet.workflow_complete",
  "wavelet.palette_uses",
  "wavelet.frame_probe",
  "wavelet.c2pa_verifies",
]);

const DEFAULT_RUBRIC_KINDS = new Set([
  "rubric.passes",
]);

export function isGate(check) {
  if (typeof check?.gate === "boolean") return check.gate;
  if (DEFAULT_GATE_KINDS.has(check?.kind)) return true;
  if (DEFAULT_RUBRIC_KINDS.has(check?.kind)) return false;
  // Unknown check kinds default to gate. Better to fail loud on a
  // deterministic-looking assertion than to silently treat it as a
  // soft signal.
  return true;
}

export function tierOf(check) {
  return isGate(check) ? "gate" : "rubric";
}
