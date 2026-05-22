---
name: skills/mount-at-path
agent: workhorse
timeoutMs: 600000
questions:
  - id: q-skills-mounted-at-runner-path
    bears_on: directly
  - id: q-skills-resolution
    bears_on: partially
turns:
  - prompt: |
      List the files inside your `skills/` directory (use `ls` or your
      file-listing tool) and then reply with two things on separate lines:

      SKILLS_DIR=<absolute path you listed>
      SKILLS=<comma-separated list of the skill filenames you found, no spaces>

      Do not interpret, summarize, or use the skills — just report what's
      on disk. End with the word DONE on its own line.
    checks:
      # Hard gate: the agent really used a file-listing tool. Catches
      # the case where the agent fabricates a directory listing from
      # training-data priors.
      - kind: session.tool_called
        name: [bash, list_dir, read, glob]
      # Sentinel: agent followed the response shape we asked for.
      - kind: session.text_contains
        substring: [DONE, Done, done]
      # Directly probes the documented mount path
      # (apps/workbooks-agent/convex/agents.ts l.670-771 — skills land at
      # /home/user/work/<sessionId>/skills/<key>.md). The session-id
      # subpath is variable so we anchor on the prefix only.
      - kind: session.text_contains
        substring: ["/home/user/work/", "/skills"]
      # At least one of the documented core skills should be present.
      # Drawn from packages/workbooks/skills/ — the bundled core set.
      # Any-of so we are robust to per-org disabling of one specific
      # skill via coreSkillSettings.disabledSkillIds.
      - kind: session.text_contains
        substring:
          - workbook-spa
          - workbook-agent
          - workbook-document
          - workbook-notebook
          - workbook-presentation
          - objective-thinking
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          The judge only sees `assistant_text`. Tool-call evidence is
          already gated by `session.tool_called` above — do not
          re-litigate it here.

          Pass if BOTH of these are true:
          1. The response contains a SKILLS_DIR= line naming a path
             that includes "/skills" (or "/home/user/work/.../skills").
          2. The response contains a SKILLS= line listing at least one
             .md file whose basename matches a known mounted skill —
             one of: workbook-spa, workbook-agent, workbook-document,
             workbook-notebook, workbook-presentation, workbook-video,
             objective-thinking, wavelet, wavelet-director, wavelet-reviewer,
             authoring-workbooks, coordinating-agents,
             engineering-discipline, INDEX (with any of the
             prefixes core-/bundled-/installed-/bundled-model-).

          Fail if ANY of these are true:
          - The response improvises a plausible-but-wrong layout
            (e.g. claims skills are in /etc/workbook/skills,
            ~/.workbook/skills, or any path outside /home/user/work/).
          - The SKILLS= line is empty.
          - The response says "I don't have a skills directory" —
            the runner contract guarantees this path exists.
---

# skills/mount-at-path

**Question:** are resolved skills actually present on disk at
`/home/user/work/<sessionId>/skills/<key>.md` where the runner expects
them? (Tracker: `q-skills-mounted-at-runner-path`.)

The skill resolution path in `apps/workbooks-agent/convex/agents.ts`
(l.670–771) merges five sources — agent-authored, provider-bundled,
model-bundled, core, installed — and writes them to `job.skills`, then
the runner mounts each as `skills/<key>.md`. If that mount ever
silently breaks, agents would behave as if no skills loaded but no
error surface would fire. This spec catches the silent drift.

The probe is direct: ask the agent to **list its own skills directory
via a real file-system tool call** and report what it sees. The gates
verify (a) it actually used a tool (not a confabulated listing), (b)
the documented path prefix is present, and (c) at least one known
core skill landed. The rubric catches the "I improvised a plausible
listing" failure mode.

This spec is a foundation for downstream skill evals — if mount-at-path
fails, every other skill spec is unreliable.
