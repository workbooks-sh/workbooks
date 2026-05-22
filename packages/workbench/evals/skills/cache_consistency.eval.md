---
name: skills/cache-consistency
timeoutMs: 900000
questions:
  - id: q-skills-cache-consistency
    bears_on: directly
sessions:
  - id: alpha
    agent: workhorse
  - id: beta
    agent: workhorse
turns:
  - session: alpha
    prompt: |
      Read the full text of your `authoring-workbooks` skill
      from the skills/ directory in your sandbox (use `cat` or your
      read tool). Write the exact text — byte-for-byte, no
      reformatting — to the substrate path
      `.skill-snapshot/alpha/authoring-workbooks.md`. Then
      compute a sha256 of THAT file's contents and write the hex
      digest (lowercase, no whitespace, no prefix) to
      `.skill-snapshot/alpha/authoring-workbooks.sha256`.
      Commit and push both files. Reply DONE when the push exits 0.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: session.tool_called
        name: [bash, read, list_dir, glob]
      - kind: substrate.file_exists
        path: .skill-snapshot/alpha/authoring-workbooks.md
      - kind: substrate.file_exists
        path: .skill-snapshot/alpha/authoring-workbooks.sha256
  # Beta runs IN PARALLEL with alpha (no `after:` barrier between
  # them). They share the same substrate clone; both will resolve
  # authoring-workbooks at session-boot time. The question is
  # whether they get the SAME content.
  - session: beta
    prompt: |
      Read the full text of your `authoring-workbooks` skill
      from the skills/ directory in your sandbox. Write the exact
      text — byte-for-byte, no reformatting — to the substrate path
      `.skill-snapshot/beta/authoring-workbooks.md`. Then
      compute a sha256 of THAT file's contents and write the hex
      digest (lowercase, no whitespace) to
      `.skill-snapshot/beta/authoring-workbooks.sha256`.
      Commit and push both files. Reply DONE when the push exits 0.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: session.tool_called
        name: [bash, read, list_dir, glob]
      - kind: substrate.file_exists
        path: .skill-snapshot/beta/authoring-workbooks.md
      - kind: substrate.file_exists
        path: .skill-snapshot/beta/authoring-workbooks.sha256
  # After both sessions push, compare. bytes_equal is sha-pinned: any
  # drift in either file is a torn-cache failure.
  - session: alpha
    after: beta.turn.0
    checks:
      - kind: substrate.bytes_equal
        left: .skill-snapshot/alpha/authoring-workbooks.md
        right: .skill-snapshot/beta/authoring-workbooks.md
      - kind: substrate.bytes_equal
        left: .skill-snapshot/alpha/authoring-workbooks.sha256
        right: .skill-snapshot/beta/authoring-workbooks.sha256
cleanup:
  - kind: substrate.remove_path
    path: .skill-snapshot
---

# skills/cache-consistency

**Question:** do parallel sessions on the same org resolve to the
same skill content? Tracker: `q-skills-cache-consistency`.

This spec closes one of the R3 leftovers by leaning on the wb-ojss.4
P1 dual-session runner — exactly the primitive R3 was waiting on.

Two workhorse sessions in the same org each independently:
1. read their mounted `authoring-workbooks.md` skill,
2. snapshot it to a session-specific substrate path,
3. hash it.

If the skill-resolution path in `apps/workbooks-agent/convex/agents.ts`
ever serves different content to two sessions in the same org (cache
slice drift, partial cache invalidation, or version-pinned-per-job
gone wrong), the `substrate.bytes_equal` cross-snapshot check fails
loudly.

Failure modes caught:

- **Torn cache** — alpha and beta see different skill text;
  bytes_equal mismatch surfaces the sha digest difference.
- **One session lost the skill entirely** — `substrate.file_exists`
  fails on the absent snapshot.
- **Agent fabricated the snapshot** — `session.tool_called` gates
  on a real file read (any of bash/read/list_dir/glob).

The choice of `authoring-workbooks` is deliberate: it's a
bundled core skill that should be present in every session
regardless of org-specific install state.

Needs wb-ojss.4 P1 (dual-session runner).
