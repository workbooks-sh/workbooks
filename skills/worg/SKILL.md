---
name: Worg — agent-native planning substrate
description: When the user mentions an org-mode file (.org), a plan, a TODO/NEXT/DONE item, asks "what should I work on next", "break this down", "I finished X", or any planning-shaped question — reach for the worg tools and treat the .org file as the source of truth. The org file IS the plan; not a config the user has to narrate around.
---

# Worg — the planning substrate

Worg (`.org` files) is how Workbooks expects plans to live. It's not a ticket tracker, it's a context-as-execution surface: the same file holds the intent, constraints, decisions, state, and history. Your job when worg is in scope is to READ the file before doing anything else, and WRITE the file as your work progresses — not chat about the plan, the plan IS the chat.

## When to reach for worg (reflexively)

Activate this skill any time the user's message has the shape of planning, prioritizing, or tracking work — even when they don't name the tool. Examples:

- "What should I work on next?" → read their plan file, surface the next NEXT/TODO.
- "Help me break this down." → load the parent headline, add level+1 NEXT children.
- "I just finished the auth refactor." → find the headline, transition to DONE, append a LOGBOOK entry.
- "Where are we on the billing migration?" → query by `:ID:` or title, summarize state + recent LOGBOOK entries.
- "Can you log a decision about which storage to use?" → append to `:NOTES:` drawer with date and rationale.

If the user mentions a `.org` file by path, ALWAYS read it first before asking clarifying questions. The path is the path; if the file is empty/missing, the right move is to read, observe-it's-missing, then offer to scaffold one — NOT to ask the user to retype their plan.

## Tools you have for worg

- `worg_parse(path)` — return structured info (headlines, states, properties, drawers). Prefer this over plain `read` for `.org` files — you get JSON, not raw text.
- `worg_query(path, filter)` — find headlines by state, property, ID, tag.
- `worg_source_blocks(path, target_id)` — return the `#+BEGIN_SRC ... #+END_SRC` blocks under a headline as JSON `[{language, body, index}, ...]`. Use this when you need to INSPECT a block before running, or pick one of several under the same headline.
- `worg_run_source_block(path, target_id, index?, write_results?)` — extract a source block AND dispatch it to the right runtime in one call: `lua` → lua_eval, `bash`/`sh`/`shell` → bash. Returns the result. If `write_results: true`, also writes the `#+RESULTS:` block under the source so the plan records what ran. This is the plan-as-program primitive — prefer it over manually extracting + dispatching.
- `worg_mutate(path, op, args)` — surgical edits via byte-range replacement. Unchanged regions round-trip exactly. Six ops:
  - `transition` — change state. `args: {new_state: "DONE"}`
  - `log` — append to `:LOGBOOK:`. `args: {entry: "..."}` (don't prepend `- ` — the tool does it)
  - `drawer` — append to ANY drawer. `args: {name: "NOTES", entry: "..."}` for non-LOGBOOK drawers (NOTES, CONSTRAINTS, custom)
  - `property` — set or update a `:PROPERTIES:` key. `args: {name: "DEPENDS_ON", value: "other-id"}` (`:ID:` is reserved)
  - `add_child` — insert a child headline. `args: {title: "...", state: "NEXT", child_id: "stable-id"}` (state optional; child goes at end of parent's subtree)
  - `result` — set `#+RESULTS:` under a source block. `args: {results: "..."}`
- `read(path)` — only use when you specifically want raw text (e.g. checking byte equality). For ALL other `.org` work, `worg_parse` first.
- `write(path)` — for fresh files. For existing `.org` files, always use `worg_mutate` — `write` destroys round-trip stability and risks corrupting `:ID:` references downstream.

## The missing-file case

If the user references a worg file that doesn't exist, the correct sequence is:

1. Read the path (you'll get "file not found" or empty).
2. State that the file isn't there yet.
3. Offer to scaffold one and PROPOSE a starting structure based on what the user said.
4. Wait for confirmation OR scaffold + show the result.

Do NOT respond with "what's in your plan?" or "describe what you're working on" — those are abdications. The file is the plan; if it doesn't exist, create it.

## Org-mode canonical structure you'll write

A typical worg file looks like:

```org
* NEXT Headline title
:PROPERTIES:
:ID: stable-identifier
:DEPENDS_ON: other-id
:END:
:CONSTRAINTS:
- One constraint per bullet, attached to this work
- Another constraint
:END:
:NOTES:
- 2026-05-21 (you): decision recorded with date and author
:END:
:LOGBOOK:
- 2026-05-21 (you): state transition or progress note
CLOCK: [2026-05-21 Wed 09:00]--[2026-05-21 Wed 10:30] =>  1:30
:END:
```

**Drawer conventions:**

- `:PROPERTIES:` — structured key/value metadata (`:ID:`, `:DEPENDS_ON:`, `:ASSIGNED_TO:`, custom).
- `:CONSTRAINTS:` — non-negotiables that gate completion (use when a constraint must be honored, not just remembered).
- `:NOTES:` — chronological decisions, rationale, links. Earlier entries are PRESERVED; revocations are additive ("REVOKED" + new direction).
- `:LOGBOOK:` — state transitions, CLOCK entries, progress pings. Append-only.

**State keywords:** TODO, NEXT, DONE are the canonical baseline. Use NEXT when the work is actively the next thing to pick up; TODO when it's queued; DONE when complete. Other workflow keywords (WAITING, BLOCKED) require a `#+TODO:` declaration at the top of the file.

## Adding decision context (the Pathmode pattern)

When you make a decision while working, write it to `:NOTES:` with date + author + rationale. The reader-in-the-future (often another agent) needs:

1. What was decided.
2. Why (especially what alternatives were rejected).
3. When (date in ISO format).

Revocations are ALSO entries — never delete the original. The history of WHY a decision was overturned is as load-bearing as the decision itself. Format:

```
- 2026-05-21 (you): REVOKED the earlier <decision> because <reason>. Switching to <new direction>.
```

## Marking progress

When the user says "I finished X" or "X is done":

1. `worg_query` or `worg_parse` to locate the headline (often by ID or title fragment).
2. `worg_mutate` to transition state (NEXT/TODO → DONE).
3. Append a `:LOGBOOK:` entry recording the completion with date.
4. If the parent has a statistics cookie `[N/M]`, update it.
5. Confirm in your reply: "transitioned X to DONE, appended LOGBOOK entry, parent now shows [N+1/M]".

## Decomposing work

When asked to break a headline down:

1. `worg_parse` the file to locate the parent (use its `:ID:`).
2. For each subtask, call `worg_mutate(op: "add_child", args: {title, state, child_id})`.
   - Pick meaningful, stable `child_id` values (short kebab-case).
   - Use `state: "NEXT"` for the next-actionable child, `state: "TODO"` for queued.
3. Optionally call `worg_mutate(op: "property", args: {name: "DEPENDS_ON", value: "other-id"})` to wire dependencies between siblings.
4. Show the resulting structure in your reply — list the new child IDs and titles.

**Do not** fall back to `write` or `worg_mutate op: "log"` to add children. Children belong as real headlines via `add_child`; logging a "decomposition" into LOGBOOK loses the structure.

## Two-agent coordination via worg

Workhorse can hand work off to another agent through the shared `.org` file: set `:ASSIGNED_TO: specialist`, transition the state to a recognized handoff state, then `delegate_to_agent` with a prompt that references the file path and the specific `:ID:`. The specialist reads the same file, does the work, mutates the state, and the hand-back is automatic — no intermediate ticket system.

## What this skill is NOT for

- Pure prose documents — that's the `authoring-workbooks` shape (document).
- Code reviews — those go through the normal review flow, not worg.
- One-off questions ("what's 2+2?") — answer directly, don't invent a plan.

When the user's question doesn't have planning shape, this skill is silent.
