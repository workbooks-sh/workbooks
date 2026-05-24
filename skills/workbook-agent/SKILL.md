---
name: Workbook (agent)
description: Build a portable single-file HTML workbook that RESPONDS TO MESSAGES and produces artifacts into a folder — chatbots, assistants, script writers, research agents, AI tools with a stage (or "canvas" — see naming note). Use when the user mentions an "agent", "chatbot", "assistant", "AI tool that writes outputs into a folder", "responds to messages", "playground", "agent with a stage", "agent with a canvas", "script writer", or "research agent". This is the default shape for ANY deliverable where the value is the agent loop (read context → respond → push to stage → write output). For static interfaces use the spa skill; for prose use the document skill; for re-runnable cells use the notebook skill.

Naming note (CRITICAL): the agent's interactive render target is canonically called a "stage" — never "canvas" in code, config, or new docs. When the user (Shane) says "canvas", translate to "stage" — he uses the words interchangeably in conversation but the code term is `stage`. `canvas` is reserved for the HTML `<canvas>` element and Studio's separate generic file-viewer pane (`CanvasPane.svelte`, different concept entirely). The skill's trigger list includes "canvas" forms so the skill activates regardless of which word the user reaches for; the skill BODY and any code/config it produces always uses `stage`.
---

# Workbook — `agent` shape

**Agents produce workbooks, not files.** This is the canonical mental model that informs every other section of this skill. Every artifact an agent ships is itself a workbook — a folder of source files that compiles to one portable `.html`. The agent's job is to scaffold, edit, build, and publish workbook folders, never to write loose `.html` files or stray text. The compiled `.html` is downstream of the source folder; the folder is the working state.

This applies regardless of what kind of workbook the agent produces:

- A script-writing agent produces **document-shape** workbooks (one per concept, prose source files in `src/`).
- A dashboard-building agent produces **spa-shape** workbooks (source code in `src/`, framework runtime bundled).
- A data-analysis agent produces **notebook-shape** workbooks (cells in `src/`, Polars/SQLite runtime bundled).
- An agent that AUTHORS OTHER AGENTS produces **agent-shape** workbooks (an agent block in `workbook.config.mjs`, system prompt + components in `src/`).

The `agent` shape itself — what this skill scaffolds — is one workbook shape among five. It's the right choice when the deliverable IS a message-driven loop. For everything else, the agent you're writing picks the appropriate output shape per artifact and runs the canonical authoring flow (below).

## The canonical authoring flow (applies to every agent regardless of shape)

```
workbook init <slug> --template=<shape>    # scaffold the workbook folder
open_stage({filepath: ".../src/<entry>"})  # right-pane shows the file forming
write / edit src/<files>                   # source edits — stage updates live
workbook build                             # compile to dist/<slug>.html
publish_workbook({path: "dist/<slug>.html"}) # uploads to the group's drive
```

Agents NEVER:
- Hand-write a raw `.html`
- Write a stray markdown file outside a workbook folder
- Skip the `workbook build` step ("just inline the result in chat")

If the deliverable is a one-line answer, use `render({block:{kind:"markdown", text:"..."}})` — that's chat, not an artifact. Anything the reader would want to keep, share, or revisit goes through `workbook init / build / publish`.

## When to pick this `agent` shape (vs another)

An agent workbook is one `.html` file that defines a message-driven loop: the reader sends a message, a model responds, tools run, and outputs land in a folder. Studio renders agents at `/chat?agent=<slug>`, NOT the workbook viewer at `/w/<id>`. The agents table holds the manifest; group membership is per-share with its own folder scoping.

Pick this shape when the deliverable RESPONDS TO MESSAGES. Pick `spa` if the deliverable is a static interface that doesn't take messages. Pick `document` if the deliverable is prose the reader reads top-to-bottom. Pick `notebook` if the reader re-runs cells.

## Hard rules

1. One file output — exactly one `<slug>.html`. No siblings.
2. Plain `.html` extension. Identity is content-based, not filename.
3. Author with `@work.books/cli`.
4. Bare `.html` is canonical — runs in any browser, source bundled inside.
5. Persistent state belongs at workbooks.sh; the `.html` itself is stateless.
6. Agents render in Studio at `/chat?agent=<slug>`, NOT the workbook viewer
   at `/w/<id>`. The artifact is bundled the same way but lives in the
   `agents` table (broker migration `0016_agents.sql`), not the `workbooks`
   table.

## Quick-start

Scaffold with the `workbook_init` tool — same template the CLI ships:

```
workbook_init({
  slug: "my-agent",
  name: "My Agent",
  shape: "agent",
  dest: "my-agent"
})
```

The `agent` template wires a minimum-viable `workbook.config.mjs` with
the required `agent` block (provider, model, systemPrompt, tools).
Edit `workbook.config.mjs` to fill in the agent's behavior, edit
`index.html` to customize the chat surface, then commit.

Publishing (`workbook publish --group <gid>`) is a step a human author
runs from outside this sandbox — there's no in-sandbox publish path
yet. Tag the workbook DONE in the substrate and the publish flow
lives at `studio.workbooks.sh`.

Human-author equivalent commands (outside this sandbox):

```bash
npm install -g @work.books/cli
workbook init my-agent --template=agent
workbook dev
workbook publish --group <gid>   # → studio.workbooks.sh/chat?agent=my-agent
```

## The `agent` block in workbook.config.mjs

`type: "agent"` is gated — the config validator requires a sibling `agent`
object. The full schema (see
`packages/workbooks/packages/workbook-cli/src/util/config.mjs`):

```js
export default {
  slug: "my-agent",
  type: "agent",
  entry: "src/index.html",
  agent: {
    provider:     "openrouter",                       // or anthropic | openai | google | litellm
    model:        "anthropic/claude-sonnet-4.6",
    systemPrompt: "You write short scripts. Call open_stage({filepath:'script.md'}) once at the start; then write/edit that file naturally — the stage auto-tracks and updates on every write.",
    tagline:      "Drafts short scripts",             // shown in Studio's agent picker
    icon:         "pen-line",                         // lucide name

    tools:        ["write_file", "read_folder"],
    extensions:   ["web-search"],

    // name → relative path to a JS file whose default export is
    // (target, props, emit) => unmount. CLI bundles each with esbuild
    // and ships them base64+gzip in <script id="wb-components">.
    //
    // Canonical name for the agent's primary render target: `stage`.
    // Studio's chat UI mounts agent.components.stage in the right pane
    // when the agent calls render({component: "stage", props: {...}}).
    // Additional named components are allowed; Studio's layout policy
    // for non-stage components is per-name (future: declarative regions).
    components: {
      stage: "src/components/stage.js",
    },

    // key → { description, docs } where docs is a path to a markdown
    // file. The agent loads the markdown on demand the way Claude
    // Code loads skill docs.
    skills: {
      "script-format": {
        description: "Beat structure + voiceover formatting rules.",
        docs: "skills/script-format.md",
      },
    },

    permissions:   { write_folder: true, read_context: true },
    defaultEnv:    { TONE: "concise" },
    schedules:     [],
    runtimeTargets: ["studio-chat"],
    capabilities:  [],
  },
};
```

Anything the broker stores for the agent is in this manifest; the publish
path serialises a subset (provider, model, systemPrompt, icon, tools,
extensions, the `keys()` of components/skills, permissions, defaultEnv)
into the `agents.manifest` JSON column. See
`packages/workbooks/packages/workbook-cli/src/commands/publish.mjs`.

## Component contract

Each entry under `agent.components` is a JS module whose default export
is a mount function:

```js
// src/components/stage.js — renders props.draft as markdown.
import { marked } from "marked";

export default function mount(target, props, emit) {
  target.innerHTML = `<article class="prose"></article>`;
  const article = target.querySelector("article");
  article.innerHTML = marked.parse(props.draft ?? "");

  emit("ready", { wordCount: (props.draft ?? "").split(/\s+/).length });

  return () => { target.innerHTML = ""; };   // unmount
}
```

`target` is the DOM node Studio gives you. `props` carries `{filepath, content}` when the runner auto-emits a stage update after a tracked write/edit — the agent doesn't have to call render() each time. The flow:

1. Agent calls `open_stage({filepath, component? = "stage"})` once. Runner stores the registration and emits an initial stage event (empty content if file doesn't exist yet).
2. Agent uses normal `write` / `edit` / `bash` tools. The runner's `tool_execution_end` hook checks the touched path against the registered stage; if it matches, the runner reads the new file content and emits a `block` event `{kind:"custom", name:<component>, props:{filepath, content}}`.
3. Studio's `latestStageProps` derived state (in `apps/studio/frontend/src/routes/(app)/chat/+page.svelte`) picks up the latest event and posts props to the stage iframe via postMessage.
4. The component's `(target, props, emit) => unmount` factory renders `props.content` however it wants — typically markdown.

The `kind:"custom"` + `name:<component>` block shape is the wire protocol; agents rarely emit it by hand because `open_stage` + natural file edits cover the common case. Use direct `render({block:{kind:"custom", ...}})` only for cases where there's no underlying file (live charts, computed widgets).
`emit(event, payload)` posts events back to the agent loop. The returned
function runs on unmount. Plain JS — no framework runtime is baked in.

## Group attachment

`workbook publish --group <gid>` POSTs to `/v1/agents` with
`group_ids: ["<gid>"]`. The broker writes:

- one row in `agents` (org-scoped, by `slug`)
- one row in `agent_group_shares` per group

Folder scoping lives on `agent_group_shares` (broker migration
`0027_agent_group_share_folders.sql`):

| Column                    | Meaning                                                   |
| ------------------------- | --------------------------------------------------------- |
| `folder_id`               | Where the agent CARD lives in the group's Drive view.     |
| `write_folder_id`         | The single folder the agent may write into (its outbox).  |
| `context_folder_ids_json` | JSON array of folder ids the agent mounts read-only at `/context/<folder-name>/`. |

The same underlying agent can appear in different folders with different
read/write contexts in different groups — the share row owns the scoping,
not the agent.

## Connections (provider keys + third-party secrets)

Declare what the agent needs in `connect`:

```js
export default {
  slug: "my-agent",
  type: "agent",
  agent: { /* … */ },
  connect: {
    OPENAI_KEY:    { inject: "bearer",   domains: ["api.openai.com"] },
    ANTHROPIC_KEY: { inject: "x-api-key", domains: ["api.anthropic.com"] },
    GITHUB_TOKEN:  { inject: "bearer",   domains: ["api.github.com"] },
  },
};
```

The broker proxy splices the value at request time — plaintext never
reaches the browser. Today a group admin sets the value via
`workbook env set OPENAI_KEY sk-… --group <gid>` (writes to
`group_env_vars`); the wb-yufs.4 capability resolver will eventually
splice org-scoped and group-scoped secrets automatically based on the
`connect` declarations.

## When NOT to use this skill

- The deliverable is a static interface with no message loop → use `spa`
  (dashboards, tools, games, presentation with custom UI).
- The deliverable is prose the reader reads top-to-bottom → use `document`.
- The deliverable is `<wb-cell>` elements the reader re-runs → use `notebook`.
- The deliverable is a slide deck → use `presentation`.

If you want to wrap an agent in a hand-built interface (e.g. a kanban
board the reader drags items around, with an agent in a side panel), the
hand-built interface still answers to messages eventually — pick `agent`
and put the kanban in a component. Studio's `/chat?agent=<slug>` surface
hosts arbitrary components; you don't need spa for "agent + custom UI".

## References

| If you need to…                                       | Load                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| understand the on-disk file format                    | [_shared/references/format.md](../_shared/references/format.md) |
| run `workbook init / dev / build / unbundle / publish`| [_shared/references/cli.md](../_shared/references/cli.md)       |
| see the full `agent` block validator                  | `packages/workbooks/packages/workbook-cli/src/util/config.mjs`    |
| see what publish sends to the broker                  | `packages/workbooks/packages/workbook-cli/src/commands/publish.mjs` |
| see the agents schema                                 | `packages/broker/worker/migrations/0016_agents.sql`              |
| see folder scoping on group shares                    | `packages/broker/worker/migrations/0027_agent_group_share_folders.sql` |

## Source of truth

- Repo: https://github.com/workbooks-sh/workbooks
- CLI on npm: `@work.books/cli`
- Studio (agent surface): https://studio.workbooks.sh/chat?agent=&lt;slug&gt;
