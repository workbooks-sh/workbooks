---
name: skills/self-audit
agent: workhorse
timeoutMs: 600000
questions:
  - id: q-skills-mounted-at-runner-path
    bears_on: directly
  - id: q-skills-resolution
    bears_on: directly
turns:
  - prompt: |
      Self-audit your skill graph. This is diagnostic — answer
      faithfully from what you find on disk, not from priors.

      Do these five steps in order, using your file-system tools at
      each step:

      1. Run `find ~/skills -name '*.md' | sort` (or equivalent) and
         paste the full output.
      2. Read `~/skills/INDEX.md` and paste its contents verbatim.
      3. Find the skill whose key contains "authoring-workbooks" (it
         may be prefixed with `core-` or `bundled-`). Read its
         SKILL.md and paste its frontmatter description.
      4. List that skill's references/ subdirectory. If it exists,
         enumerate the reference filenames.
      5. Read `references/agent-shape.md` (relative to the
         authoring-workbooks skill) if present. Find the section
         titled "Skills as files — the SKILL.md pattern" and paste
         its first ~5 lines verbatim.

      Reply with this structure exactly (one field per line, no
      flourishes between fields):

      TREE_FILES_COUNT=<integer count of .md files under ~/skills>
      INDEX_FOUND=<yes|no>
      INDEX_LINE_COUNT=<integer line count of INDEX.md if found, else 0>
      AUTHORING_KEY=<exact key, e.g. authoring-workbooks, or "not found">
      AUTHORING_DESCRIPTION=<the description string, or "not found">
      REFERENCES_DIR_PRESENT=<yes|no>
      REFERENCES_LIST=<comma-separated filenames, or "none">
      AGENT_SHAPE_FOUND=<yes|no>
      AGENT_SHAPE_HEADING_QUOTE=<quoted excerpt of the section's first lines, or "absent">

      Then end with DONE on its own line.

      Do not summarize, interpret, or judge what you find. The
      structured fields are the entire payload.
    checks:
      # Hard gate: used a tool. Without this, the rest is fiction.
      - kind: session.tool_called
        name: [bash, list_dir, read, glob]
      - kind: session.text_contains
        substring: [DONE, Done, done]
      # The five field markers must all appear — confirms the agent
      # followed the requested response shape.
      - kind: session.text_contains
        substring: "TREE_FILES_COUNT="
      - kind: session.text_contains
        substring: "INDEX_FOUND="
      - kind: session.text_contains
        substring: "AUTHORING_KEY="
      - kind: session.text_contains
        substring: "REFERENCES_LIST="
      - kind: session.text_contains
        substring: "AGENT_SHAPE_FOUND="
---

# skills/self-audit

**Purpose:** diagnostic probe of the skill graph as deployed. NOT a
production eval — this exists to answer "is the graph reaching the
runner as we expect?" after wb-uptt cutover.

What the structured response tells us:

| Field | What it diagnoses |
|-------|-------------------|
| `TREE_FILES_COUNT` | How many .md files actually mount under `~/skills/`. If <13, something dropped. Expected: ~10-20 (3 new graph + 5 references + bundled core skills). |
| `INDEX_FOUND` + `INDEX_LINE_COUNT` | INDEX generator ran. If no, wb-uptt.2 isn't actually emitting. |
| `AUTHORING_KEY` | The exact key the new graph skill mounts under. Tells us if the generator's `core-` prefixing is correct. |
| `AUTHORING_DESCRIPTION` | Frontmatter survived the bundle pipeline. |
| `REFERENCES_DIR_PRESENT` + `REFERENCES_LIST` | The references/ subdir mounted alongside SKILL.md. If no, the generator/runner reference-emission path is broken. |
| `AGENT_SHAPE_FOUND` + `AGENT_SHAPE_HEADING_QUOTE` | The actual reference content reached disk and is readable. |

The gates only verify the agent USED tools and followed the response
shape. There is no rubric — we read the structured fields ourselves
to diagnose. Single-run is sufficient; we are observing, not
adjudicating reliability.

This spec is also a meta-canary for q-skills-mounted-at-runner-path:
if every field comes back populated correctly, the runtime skill
contract holds end-to-end. If any field is missing or wrong, the
field name tells us exactly which layer broke.
