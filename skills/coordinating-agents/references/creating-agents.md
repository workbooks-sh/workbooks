# Creating durable agents and groups

These two tools register durable resources under the user's account. Reach for them when the user describes a role they want to keep around or a shared space they want to scope work into — not for one-off requests.

## `create_group`

Spin up a new group (workspace) the user owns. Use when they ask for a new shared collection, or when they want to scope agents and workbooks to a team.

```
create_group({
  name: "Q3 launch crew",
  description: "Agents and workbooks supporting the Q3 product launch",
  slug: "q3-launch",          // optional; derived from name if omitted
  icon: "rocket"              // optional lucide name
})
```

Returns `{id, slug, name}`. The user becomes the group owner. Subsequent agents or workbooks created with `group_ids: [id]` show up under that group.

## `create_agent`

Register a brand-new agent in the user's catalog. Use when they describe a specific role they want to keep around — "a code reviewer that knows our style", "a weekly metrics drafter", "an SOC2 evidence collector". Not for one-shot tasks.

```
create_agent({
  slug:         "code-reviewer",
  title:        "Code reviewer",
  systemPrompt: "You review pull requests against the team's style guide…",
  tagline:      "Reviews PRs against our style",       // optional, shown in pickers
  description:  "Catches style, scope, and clarity issues before merge",
  icon:         "git-pull-request",                    // optional lucide name
  model:        "anthropic/claude-opus-4.6",           // optional; default shown
  tools:        ["read", "bash", "render"],            // optional; defaults to a sensible base set
  group_ids:    ["<group id>"]                         // optional; pin to one or more groups
})
```

Returns `{id, slug, created}`. The default model is `anthropic/claude-opus-4.6`. If `group_ids` is omitted, the agent lands in the user's personal catalog only.

## When to create vs delegate

- The user describes a recurring role they want to OWN → `create_agent`. They'll see it in their catalog after.
- The user wants a one-off task done now → `delegate_to_agent` to an existing specialist, or do it yourself.
- The user describes a team or project space → `create_group` first, then create agents and workbooks scoped into it.

Don't `create_agent` for ephemeral roles. A catalog full of single-use agents is worse than no specialist at all — the user can't tell which one to pick next time.

## After creating

Surface the new resource concretely:

```
render({
  block: {
    kind: "callout",
    tone: "ok",
    title: "Agent created",
    text: "**code-reviewer** is now in your catalog. Open `/chat?agent=code-reviewer` to talk to it, or call it from any session with `delegate_to_agent({slug:'code-reviewer', prompt:'…'})`."
  }
})
```

The user should leave the turn knowing exactly where the new thing lives and how to reach it.
