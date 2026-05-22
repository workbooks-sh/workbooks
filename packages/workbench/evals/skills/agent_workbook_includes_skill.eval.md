---
name: skills/agent-workbook-includes-skill
agent: workhorse
timeoutMs: 1500000
questions:
  - id: q-skills-agent-published
    bears_on: partially
turns:
  - prompt: |
      Build me an agent workbook for code review. The agent should
      apply a specific reviewing style — terse, root-cause oriented,
      cites failure modes, refuses to bikeshed naming.

      Define that style as its own **skill** the agent workbook
      ships with: write it at `cr-agent/skills/review-style/SKILL.md`
      inside the workbook, give it real content (rules, examples,
      what to do, what not to do), and reference it from the agent's
      manifest.skills array in `cr-agent/workbook.config.mjs`.

      Use the slug "cr-agent" exactly. Place the workbook at the
      substrate root. Build (do not publish). Reply DONE when the
      tree pushes.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      # Agent workbook landed
      - kind: substrate.file_exists
        path: cr-agent/workbook.config.mjs
      - kind: substrate.file_contains
        path: cr-agent/workbook.config.mjs
        substring: 'type: "agent"'
      # Skill file landed at the requested path
      - kind: substrate.file_exists
        path: cr-agent/skills/review-style/SKILL.md
      # Skill body has substantive content — frontmatter + section
      # headings (catches "I wrote a TODO" empty stubs). The agent
      # gets to choose the heading text, so we anchor on Markdown
      # structural cues that any real skill would have.
      - kind: substrate.file_contains
        path: cr-agent/skills/review-style/SKILL.md
        substring: "---"
      - kind: substrate.file_contains
        path: cr-agent/skills/review-style/SKILL.md
        substring: "#"
      # Manifest references the skill. Looser substring set so the
      # agent can use either "review-style" or "review_style" or a
      # path-shaped reference — any one is acceptable evidence the
      # reference exists.
      - kind: substrate.file_contains
        path: cr-agent/workbook.config.mjs
        substring: "review-style"
      # Builds cleanly
      - kind: workbook.build
        workbookPath: cr-agent
        probe:
          domSelectors:
            - 'script[type="module"]'
          noConsoleErrors: true
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. The response confirms a code-review agent was scaffolded
             at the "cr-agent" slug.
          2. The response describes the skill that was authored —
             names it ("review-style"), summarizes its rules, or
             quotes the section structure of the SKILL.md file.
          3. The response references the manifest.skills wiring
             (mentions the skill being listed in the agent's
             manifest / config / skills array).

          Fail if ANY of these are true:
          - The agent wrote the skill INLINE in the system prompt
            instead of as a separate SKILL.md file — the spec asks
            for it as a skill, not as a longer system prompt. (The
            substrate.file_exists gate catches this objectively;
            the rubric reinforces it.)
          - The skill file is a placeholder ("# TODO" or "your skill
            here") — no real review-style content.
          - The response claims the skill exists but the
             manifest.skills wiring is missing.
          - The response describes a non-agent shape (SPA, document,
             notebook) — does not satisfy the agent-workbook ask.
cleanup:
  - kind: substrate.remove_path
    path: cr-agent
---

# skills/agent-workbook-includes-skill

**Question:** can an agent author a custom skill INSIDE a workbook —
write the `SKILL.md`, reference it in the agent's manifest, and ship
a buildable workbook? (Tracker: `q-skills-agent-published`, Path 1.)

This is the authoring half of the agent-publishes-skill loop:

- **Path 1 (this spec):** the agent writes a skill into the
  workbook tree at `skills/<key>/SKILL.md` and wires it into
  `manifest.skills`. The skill ships **with** the workbook.
- **Path 2 (separate spec, blocked on wb-ojss.3.2):** the agent
  registers a NEW skill org-wide via a Convex mutation so other
  agents in the org can pick it up. No documented workflow yet.

Path 1 is testable today because it uses substrate writes + workbook
build only — no Convex mutations, no broker side-effects, no publish
operator gate. The downstream verification (does the published
workbook's recipient ACTUALLY load that skill?) requires either a
multi-session probe or a publish + fresh-session roundtrip; not
covered here.

Gates stack from concrete to interpretive, deliberately objective so
the rubric only adjudicates the response narrative:

- `substrate.file_exists` × 2 — workbook config + skill file landed
- `substrate.file_contains type: "agent"` — correct shape
- `substrate.file_contains "---" + "#"` — skill body has frontmatter
  and at least one heading (filters TODO stubs)
- `substrate.file_contains "review-style"` in the workbook config —
  manifest wiring is present
- `workbook.build` — artifact compiles

The most likely failure mode is the agent collapsing the skill into
a longer system prompt rather than writing a separate SKILL.md.
The substrate gate is the hard catch; the rubric's Fail-if reinforces
it for surface clarity.

This spec does not call `workbook.publish` — publishing is an
operator-gated action with public-state side effects. The build
gate proves the local authoring loop completes; the publish-and-load
roundtrip is future work tied to wb-ojss.3.2.
