# `type: "agent"` workbooks

An agent workbook is one `.html` that defines a message-driven loop. Studio renders it at `/chat?agent=<slug>`, not the workbook viewer. Use this shape whenever the deliverable responds to messages — chatbots, assistants, script writers, research agents. For static interfaces use `spa`; prose, `document`; cells, `notebook`.

## Scaffold

```bash
workbook init my-agent --template=agent
cd my-agent
# edit src/ and workbook.config.mjs
workbook build
workbook publish dist/my-agent.html --group <gid>
# → studio.workbooks.sh/chat?agent=my-agent
```

## The `agent` block in `workbook.config.mjs`

`type: "agent"` is gated — the config validator requires a sibling `agent` object:

```js
export default {
  slug: "my-agent",
  type: "agent",
  entry: "src/index.html",
  agent: {
    provider:     "openrouter",
    model:        "anthropic/claude-sonnet-4.6",
    systemPrompt: "You write short scripts. Call open_stage once, then write/edit the script file.",
    tagline:      "Drafts short scripts",
    tools:        ["write_file", "read_folder"],
    components:   { stage: "src/components/stage.js" },
    skills:       ["script-format", "voiceover-tone"],  // keys → skills/<key>/SKILL.md
  },
};
```

## Skills as files — the SKILL.md pattern

The part agents get wrong most often.

Each entry in `manifest.skills` is a STRING KEY that resolves to `skills/<key>/SKILL.md` inside the workbook tree. The SKILL.md is a standalone file with its OWN frontmatter. The runtime loads the markdown on demand.

Worked example. After `workbook init my-agent --template=agent`, write `skills/script-format/SKILL.md`:

```markdown
---
name: Script format
description: When the user asks for a video script, this skill teaches you the beat structure and voiceover formatting rules.
---

# Script format

Three-beat structure: hook (8s), body (90s), CTA (12s).

- Each VO line on its own paragraph.
- Bracket stage directions: `[cut to overhead drone]`.
- Don't use em-dashes — they read awkwardly aloud.
```

Then reference it by key in `workbook.config.mjs`:

```js
agent: {
  // …
  skills: ["script-format"],
}
```

`workbook build` bundles the SKILL.md into the compiled `.html`. At runtime, the agent's loop loads `skills/script-format/SKILL.md` when a matching turn arrives.

## Anti-pattern — collapse-into-manifest

Do NOT inline the skill content into the agent's `systemPrompt` field:

```js
// WRONG — defeats the skill mechanism.
agent: {
  systemPrompt: "You write scripts. Use three-beat structure: hook 8s, body 90s, CTA 12s. Each VO line on its own paragraph. Bracket stage directions…",
  skills: [],
}
```

Why wrong:
- The system prompt is paid on every turn; skills load on demand.
- Skills are independently editable and discoverable; inlined text isn't.
- The eval framework treats `manifest.skills` as a contract — an empty array with content inlined in the prompt fails the skill-presence check.

## Multiple skills

One file per coherent domain. A script-writing agent might ship:

```
skills/
  script-format/SKILL.md       # beat structure
  voiceover-tone/SKILL.md      # voice register
  thumbnail-brief/SKILL.md     # designer brief
```

Each folder has its own `SKILL.md` and optionally its own `references/`. The pattern is recursive — agents you author follow the same skill-graph shape your own skills do.

Components render UI in the stage; skills carry procedural knowledge. Both live in the manifest.
