# %%NAME%%

A `type:"agent"` workbook. Unlike an `spa` (a static interface the reader interacts with directly), an agent is a server-side LLM loop that the reader messages, with the agent pushing drafts into a `stage` component the reader watches. The `.html` artifact is a catalog page; the actual loop runs in Studio after publish.

## What's in this scaffold

- `workbook.config.mjs` — declares `type:"agent"` and the agent block (provider, model, system prompt, tools, components). The system prompt is loaded from `src/system-prompt.md` at build time.
- `src/system-prompt.md` — the agent's persona, scope, and house rules. **Rewrite this first.** Everything downstream — tools, components, folder permissions — should serve what you put here.
- `src/components/stage.js` — the agent's stage. A component matching the `(target, props, emit) => unmount` contract. The agent calls `render({ component: "stage", props: { draft } })` to push the current draft in; `props.draft` is the current text. Replace with whatever the agent's outputs need (table, slides, code editor, etc.).
- `index.html` + `styles.css` — the static catalog page. Reader-facing controls live in Studio, not here.

## Fill it in

1. Rewrite `src/system-prompt.md` — who the agent is, what it expects in messages, what it writes.
2. Edit `src/components/stage.js` — render whatever shape the agent's outputs take.
3. Add tools the agent should call. Bare names map to pi-coding-agent built-ins; `oauth:<toolkit>` binds a broker-managed OAuth toolkit (requires a Studio → Integrations connection).
4. Declare folders the agent reads/writes via `agent.permissions: { write_folder, context_folder }` once you've created the group.

## Build and attach to a group

```
workbook check                       # validate config
workbook build                       # produces dist/%%SLUG%%.html
workbook publish --group <group-id>  # registers the agent against a Studio group
```

`publish` POSTs to `/v1/agents` (not `/v1/workbooks`), uploads the artifact, and the agent shows up in Studio's `/chat` agent picker for that group.

## Iterate

Edit the system prompt or components, re-run `workbook build`, re-run `workbook publish --group <id>`. Studio replaces the existing agent of the same slug.

## See also

- `packages/workbooks/skills/workbook-agent/SKILL.md` — full skill reference (system-prompt patterns, tool selection, folder design).
- `workbook explain` — every rule the validator enforces.
