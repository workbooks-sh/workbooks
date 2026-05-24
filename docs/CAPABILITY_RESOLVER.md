# Studio capability resolver

> Status: design (2026-05-16). Tracking issue: **wb-yufs.4**. Replaces
> the ad-hoc `connect: { NAME: { inject, domains } }` + `connectScopes`
> wiring that grew up around `workbook publish` and the v1 UGC Pro
> buildout. This document specifies the resolver as a single platform
> primitive — one model for every credential, OAuth token, integration,
> and skill a workbook or agent might depend on.

A workbook or agent declares *what capabilities it needs*. The Studio
holds *what capabilities the user/group actually has*. The capability
resolver is the bridge: a CLI step + a broker endpoint + a runtime
envelope that join the two so the deployed artifact "just works"
without anyone pasting keys, BYOK-prompting recipients, or hand-wiring
env vars per workbook.

This is the missing primitive that caused the v1 UGC Pro buildout to
ship a chat panel that prompted Shane for his OpenRouter key even
though Shane (admin) had OpenRouter connected at the studio level.
Generalizing past that one symptom: every workbook + agent has this
gap today.

---

## What is a capability?

A **capability** is anything the workbook needs from outside its own
sandbox to function. The current taxonomy (extensible):

| Family             | Examples                                                                                  | Today's storage                                  |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| LLM provider       | OpenRouter, Anthropic, OpenAI, Google, LiteLLM                                            | Studio Integrations (user `private` scope), grow |
| OAuth toolkit      | Broker-managed OAuth: gmail, drive, slack, github, brave_search, exa, …                  | `oauth_connections` rows (private / N groups / org) |
| Env-var secret     | Custom API keys spliced into outbound HTTP (`Authorization: Bearer …`, `?api_key=…`)      | `group_env_vars` (KEK-wrapped, domain-allowlisted)|
| Database           | Postgres / D1 / Convex / SQLite-the-broker-hosts                                          | `database_connections` (per group)              |
| Identity / OAuth   | WorkOS sign-in, Sign-in-with-ChatGPT, GitHub via WorkOS Pipes                             | Session + Pipes config                           |
| Skill / docs ref   | A markdown skill bundle the agent should treat as context                                 | `packages/workbooks/skills/<slug>/`                |
| Custom HTTP        | Anything else with an injection rule + domain allowlist                                   | `group_env_vars` (same row shape as env-var)    |

The resolver doesn't care about the family beyond *what kind of
splice rule it needs at the broker proxy*. Adding a new family is a
new dispatch rule + a row in the catalog — not a new resolver.

### Scope model (locked, decided 2026-05-16 with Shane)

Connections are **group-specific by default**. An admin connects a
capability and explicitly shares it with each group via the Studio
Integrations page. No org-wide implicit propagation. Mirrors the
existing `private / N groups / team` model the `workbook connections
list` CLI already shows — the resolver always uses the explicit
group-share path; `team` (org-wide) is an opt-in escalation.

This avoids surprise leakage: one client's group never inherits
another client's key because they happen to share an org.

---

## Today vs after the resolver

Today (every workbook reinvents this):

```js
// workbook.config.mjs — ad-hoc, per-workbook, no resolution
export default {
  type: "spa",
  connect: {
    ANTHROPIC_API_KEY: {
      inject: "header:x-api-key",
      domains: ["api.anthropic.com"],
    },
  },
  // ...
};
```

→ at build time, nothing happens. At publish time, a stderr warning
maybe fires for unmapped database slots. At runtime, the workbook
hopes someone wired `ANTHROPIC_API_KEY` via `workbook env set` first;
if not, an outbound call to `api.anthropic.com` 401s and the workbook
breaks silently.

After the resolver:

```js
// workbook.config.mjs — single canonical capability declaration
export default {
  type: "agent",
  agent: { provider: "openrouter", model: "anthropic/claude-sonnet-4.6", /* … */ },
  capabilities: {
    "llm:openrouter":       { scope: "group" },
    "oauth:google_drive":   { scope: "user" },
    "env:BRAVE_SEARCH_KEY": { scope: "group", inject: "header:X-Subscription-Token", domains: ["api.search.brave.com"] },
  },
};
```

→ at `workbook build`, the CLI calls `POST /v1/capabilities/resolve`
with the manifest + target group id. The broker returns an envelope
listing what's resolved, what's unresolved, and the dispatch
references. The CLI embeds the **references only** (never plaintext)
into the artifact. The Studio admin checklist (wb-kd42) lights up the
unresolved entries in real time. At runtime, outbound calls route
through the broker proxy which splices the actual values
server-side.

If the user runs the CLI without a Studio bearer (OSS / offline), the
resolver step is skipped and the workbook falls back to
`process.env` + `workbook.config.mjs > defaultEnv` exactly like
today. No regression for unauthenticated authors.

---

## The capability declaration

One block in `workbook.config.mjs`. Everything an author needs to say
about external dependencies lives here.

```js
capabilities: {
  // Family-prefixed slug. Family determines dispatch shape.
  "<family>:<name>": {
    scope: "group" | "user" | "org",  // who supplies the credential
    inject?: "header:<X>" | "bearer" | "query:<p>" | "body:<jsonpath>",
    domains?: ["<host>", "*.<host>"],  // outbound allowlist for splicing
    optional?: true,                   // resolver tolerates missing
    docs?: "<skill-slug>" | "<url>",   // hint for the developer agent
  },
}
```

Family-prefixed slugs (`llm:openrouter`, `oauth:google_drive`,
`env:BRAVE_SEARCH_KEY`) are intentional — they collapse the
mental-model overhead of "is this a connection or an env var or a
toolkit?" into one namespaced lookup.

**Required vs optional**: an unresolved required capability blocks
publish (with a clear error pointing at the Studio Integrations page
to wire it). An unresolved optional capability publishes a warning and
the workbook ships with the reference still in place — runtime
attempts to use it fail gracefully.

**Inject rules** are only meaningful for `env:*` and custom HTTP-style
capabilities. For `llm:*` the dispatch rule is implicit (provider's
canonical endpoint + auth scheme); same for `oauth:*` (broker
dispatch via the per-provider OAuth client). The optional
`inject`/`domains` are explicit overrides for
the rare case the author needs to point at a non-canonical endpoint.

---

## The capability catalog

Studio publishes a catalog of every capability the platform knows how
to dispatch. The CLI fetches it for developer-agent consumption.

```
GET /v1/capabilities/catalog
→
{
  "capabilities": [
    {
      "slug": "llm:openrouter",
      "family": "llm",
      "name": "OpenRouter",
      "description": "Unified gateway to LLM providers (Anthropic, OpenAI, Google, Mistral, etc.).",
      "endpoint": "https://openrouter.ai/api/v1",
      "auth": { "scheme": "bearer" },
      "scopes_available": ["user", "group", "org"],
      "docs_url": "/skills/capability-llm-openrouter/SKILL.md",
      "skill_slug": "capability-llm-openrouter",
      "models_catalog": "/v1/capabilities/llm/openrouter/models"
    },
    {
      "slug": "oauth:google_drive",
      "family": "oauth",
      "name": "Google Drive",
      "scopes_available": ["user", "group"],
      "docs_url": "/skills/capability-oauth-google-drive/SKILL.md",
      "actions_catalog": "/v1/capabilities/oauth/google_drive/actions"
    },
    /* … */
  ]
}
```

Every catalog entry MUST carry `docs_url` and SHOULD carry a
`skill_slug`. The developer-agent loop (`workbook capabilities
explain <slug>`, see below) uses these to surface the right
documentation to the CLI session without the human or sub-agent having
to hunt for it.

### Catalog growth

Adding a new capability = adding one row to the broker's catalog
table + (optionally) a skill bundle under `packages/workbooks/skills/`
prefixed `capability-<family>-<name>`. No CLI change, no runtime
change — the resolver dispatches by family rules already implemented
at the broker proxy.

---

## Resolution endpoint

```
POST /v1/capabilities/resolve
Authorization: Bearer <studio-session>
Content-Type: application/json

{
  "manifest_capabilities": {
    "llm:openrouter":       { "scope": "group" },
    "oauth:google_drive":   { "scope": "user" },
    "env:BRAVE_SEARCH_KEY": { "scope": "group", "inject": "header:X-Subscription-Token", "domains": ["api.search.brave.com"] }
  },
  "group_id": "<gid>" | null,
  "for": "build" | "publish" | "dev"
}

→
200 {
  "resolved": [
    {
      "slug": "llm:openrouter",
      "scope": "group",
      "ref": "wb-cap-ref://group/<gid>/llm/openrouter/<row-id>",
      "endpoint_hint": "https://openrouter.ai/api/v1",
      "models_hint": ["anthropic/claude-sonnet-4.6", /* … */]
    },
    {
      "slug": "env:BRAVE_SEARCH_KEY",
      "scope": "group",
      "ref": "wb-cap-ref://group/<gid>/env/BRAVE_SEARCH_KEY/<row-id>",
      "inject": "header:X-Subscription-Token",
      "domains": ["api.search.brave.com"]
    }
  ],
  "unresolved": [
    {
      "slug": "oauth:google_drive",
      "scope": "user",
      "reason": "no_private_connection",
      "wire_url": "https://studio.workbooks.sh/integrations?install=oauth:google_drive&scope=user"
    }
  ],
  "audit_id": "<rid>"   // logged at broker; tied to next publish if any
}
```

**Plaintext NEVER appears in the response.** The `ref` is an opaque
identifier the broker proxy uses at dispatch time to look up the
KEK-wrapped row. Stealing a `ref` from a built artifact buys the
attacker nothing — refs are scoped to `(group, user, capability)` and
the proxy re-checks bearer at every outbound dispatch.

### Status codes

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| 200  | All required resolved (200 even if optional unresolved — see `unresolved[]`)             |
| 400  | Manifest invalid (unknown slug, malformed scope, etc.)                                   |
| 401  | No / expired Studio session                                                              |
| 403  | Caller is not a member of `group_id`                                                     |
| 409  | Required capability unresolved AND `for: "publish"` — block publish, return wire links   |

`for: "dev"` always returns 200 — local dev should never block on
unresolved capabilities; the developer agent surfaces what's missing
and continues with stubs/mocks.

---

## Build-time embedding

The CLI's `build` step calls the resolver after the rest of the
manifest is finalized. The response gets emitted into the artifact as
a single script tag:

```html
<script id="wb-cap-resolved"
        type="application/x-workbook-capabilities"
        data-version="1">
{
  "audit_id": "<rid>",
  "resolved": [
    { "slug": "llm:openrouter", "ref": "wb-cap-ref://…", "endpoint_hint": "…" }
  ],
  "unresolved_optional": [],
  "proxy_base": "https://auth.workbooks.sh/v1/proxy/"
}
</script>
```

Same pattern as `wb-source-bundle`: `type` is intentionally not
`application/javascript` so browsers ignore it at parse time. Only the
workbook runtime reads it.

**No plaintext, no values, just references + endpoint hints.** The
hints help the workbook runtime build URLs locally without an extra
round-trip; the actual auth header injection happens at the broker
proxy.

---

## Runtime dispatch

The workbook runtime exposes a single helper:

```ts
import { call } from "@work.books/runtime/capabilities";

const r = await call("llm:openrouter", {
  path: "/chat/completions",
  body: { model: "anthropic/claude-sonnet-4.6", messages: [...] },
});
```

`call(slug, request)` does:

1. Look up the `slug` in `wb-cap-resolved`. If absent → throw with a
   clear "capability not declared in manifest" error pointing at the
   author's `workbook.config.mjs`.
2. Build the proxy URL: `<proxy_base><ref-path>` + the request path.
3. Forward the request with the **viewer's** Studio bearer (not the
   author's). The broker proxy validates membership in the group that
   owns the `ref`, splices the actual credential into headers/query
   per the resolved dispatch rule, and forwards to the upstream.
4. Returns the upstream response stream-passthrough.

The viewer's bearer matters: it means the splice is bound to whoever
is currently using the workbook, not whoever built it. An attacker who
exfiltrates the built `.html` cannot use its capabilities without also
having a valid Studio session that's a member of the right group.

### Falling back to direct dispatch

If `wb-cap-resolved` is absent (offline build, OSS user with no
Studio session), `call()` falls back to direct dispatch using
`process.env` (server / Node runtime) or a runtime-config object the
author passes. Same API, no resolver — useful for unit tests and
local development before the workbook is attached to a group.

---

## Developer CLI surface

The CLI grows a small `capabilities` namespace mirroring the existing
`connections` / `env` / `group` namespaces. Every command is
read-mostly; mutations (granting a capability to a group, rotating a
key) happen in Studio Integrations.

```
workbook capabilities catalog                   # list everything Studio dispatches
workbook capabilities catalog --family llm      # filter
workbook capabilities resolve --group <gid>     # what would build/publish resolve right now?
workbook capabilities explain <slug>            # full schema + auth + skill docs + dispatch rules
workbook capabilities probe <slug> [--group <g>] # send a hello request through the proxy
workbook capabilities skills <slug>             # print the capability's skill markdown
workbook capabilities wire <slug>               # open the Studio Integrations wire-url in $BROWSER
```

`explain` and `skills` are the developer-agent surface — when a
sub-agent is authoring a workbook and the user asks "add Brave
search", the sub-agent calls `workbook capabilities explain
oauth:brave_search` (or `env:BRAVE_SEARCH_KEY` depending on which
catalog entry matches) and gets back enough to author correctly:

- the canonical slug to declare
- the scopes available
- the dispatch shape
- a code snippet showing `call()` usage
- a link to the full skill markdown

`probe` is the canary command — runs the dispatch end-to-end with a
known-safe request (e.g., GET `/v1/models` for OpenRouter, GET
`/about` for a custom HTTP API) and returns 200/4xx. Useful before
publish, useful in CI.

---

## Skill / doc surfacing

Every capability in the catalog SHOULD ship a skill bundle at
`packages/workbooks/skills/capability-<family>-<name>/` with a SKILL.md
and any references the author needs. The catalog entry's
`skill_slug` is what `workbook capabilities skills <slug>` and
`workbook capabilities explain <slug>` pull from.

Why this matters: the developer agent that's authoring workbooks reads
skills. Without a structured skill per capability, every agent
re-derives the dispatch shape from sparse code comments. With one,
authoring a workbook that uses Brave search is "find the slug,
declare it, call it, done."

Skill bundle structure (mirrors the existing `workbook-spa`,
`workbook-document`, etc. skills):

```
packages/workbooks/skills/capability-llm-openrouter/
  SKILL.md             # frontmatter + body
  references/
    models-catalog.md  # current model list + costs
    streaming-shape.md # SSE response format
```

The skill body always covers: what the capability is, what scope
recommendations look like, the dispatch shape, a one-block authoring
example using `call()`, and links to the upstream provider's docs.

---

## Security invariants

These are the rules that DO NOT bend. Reviewers should flag any PR
that violates them.

1. **Plaintext never leaves the broker.** Resolved envelopes contain
   refs + hints, not values. The proxy splices server-side at
   dispatch time.
2. **The viewer's bearer authorizes dispatch.** Built artifacts are
   not capability-bearer tokens. A leaked `.html` exfiltrates no
   credentials — re-using its capabilities requires a valid Studio
   session in the owning group.
3. **Scope is enforced at resolve AND dispatch.** Group-scoped refs
   only resolve for callers who are members of that group; the proxy
   double-checks at every dispatch (resolve-time membership doesn't
   imply dispatch-time membership — the resolve could be 30 days
   stale).
4. **Domains are allowlisted.** Custom HTTP / env-var capabilities
   never splice into outbound requests whose host doesn't match the
   capability's `domains` list. Wildcards permitted (`*.example.com`)
   but no `*` standalone.
5. **Refs are opaque and scoped.** A ref encodes
   `(scope, owner, family, name, row_id)` server-side; clients
   receive an opaque string. No path traversal, no scope upgrade.
6. **Audit every resolve.** Every `POST /resolve` writes a row:
   `(caller_sub, group_id, manifest_hash, resolved_slugs[],
   unresolved_slugs[], for, when)`. Joined to the next `publish`
   call so we can answer "what did this artifact actually link to?"
   for incident response.
7. **No silent escalation.** A `scope:'group'` declaration that
   resolves to a `team`-scoped connection MUST surface that
   substitution in the response (`resolved[].actual_scope`). Authors
   should know if their group-bound declaration is using an org-wide
   credential — useful for tear-down audits.

---

## Fallback: no Studio session

The CLI is the OSS user's primary surface, and many of them never
sign into Studio. The resolver MUST degrade cleanly:

- `workbook build` with no Studio bearer → skip the resolve step.
  Artifact ships without a `wb-cap-resolved` script tag. At runtime,
  `call()` falls back to direct dispatch using `process.env` and the
  manifest's `defaultEnv` block (existing behavior).
- `workbook publish` to anywhere (any broker, any group) — same
  graceful path. The publish endpoint already accepts a manifest
  without `wb-cap-resolved`; this just continues to work.
- All `workbook capabilities *` commands print a short "you're not
  signed in to Studio; run `workbook login` to enable capability
  resolution" notice and exit 1 (except `catalog --offline` which
  reads a bundled snapshot of the public catalog — useful for
  air-gapped authoring).

The Studio resolver is an *enhancement*, never a *gate*. Workbooks
remain portable single-file artifacts that run from `file://` with no
network dependency for code execution.

---

## Migration from today's machinery

Three legacy mechanisms collapse into the resolver:

1. **`connect: { NAME: { inject, domains } }` in workbook.config.mjs**
   → becomes `capabilities: { "env:NAME": { scope: "group", inject,
   domains } }`. The CLI accepts both shapes for one minor version
   with a deprecation warning, then drops `connect`. Existing
   `group_env_vars` rows are read by the resolver under the
   `env:<NAME>` slug.

2. **`/v1/connections` (OAuth toolkits) with `scope: private | N
   groups | team`** → becomes the `oauth:*` family in the catalog,
   resolved through the same endpoint. The existing private/groups/team
   scope storage stays — just exposed through a unified slug.

3. **`maybeWarnAboutUnmappedDatabases` at publish** →
   generalizes to "any unresolved required capability blocks publish
   with 409." Databases become `db:<slot-name>` slugs. The dedicated
   warning code path collapses into the same resolve flow.

The v0 forward-compat `connectScopes[]` array we added to the v1 UGC
Pro workbooks is OBSOLETE the moment the resolver lands. The cleanup
sub-agent (wb-yufs.9) already removed those v1 files; nothing else in
the repo carries that shape.

---

## Phasing

Ship in three phases so we get value before the whole thing exists:

### Phase 1 — Read-only resolution (the unblocker)

- Broker: catalog endpoint, resolve endpoint (read-only — no new
  storage tables, just joins over existing `group_env_vars`,
  `connections`, `database_connections`).
- CLI: `workbook capabilities catalog | resolve | explain`. No build-
  time embedding yet.
- Runtime: nothing. Workbooks continue to use direct dispatch +
  manual `workbook env set` for now.

Goal: agents authoring workbooks can DISCOVER and DECLARE capabilities
correctly. The wb-kd42 admin checklist UI lights up using this same
endpoint.

### Phase 2 — Build-time envelope + runtime dispatch

- CLI: `build` step calls resolve, embeds `wb-cap-resolved`.
- Runtime: `call(slug, request)` helper added to
  `@work.books/runtime/capabilities`. Proxy URL construction +
  fallback path.
- Broker: extend the existing `group_env_vars` proxy to handle
  refs from the resolver (right now it only handles header splicing
  for explicit slot names; needs to also handle the family-level
  dispatch rules for LLM / OAuth families).

Goal: the script-writer agent (wb-yufs.10 rebuild) "just works"
without BYOK prompts.

### Phase 3 — Skill bundles + dev loop

- Author skill bundles per capability family (start with
  `llm:openrouter`, `llm:anthropic`, `oauth:google_drive`,
  `oauth:brave_search`, `env:GENERIC`).
- CLI: `workbook capabilities skills | probe | wire`.
- Studio: live "missing capabilities" admin checklist (wb-kd42)
  consumes the resolve endpoint with `for: "dev"` to render real-time
  per-workbook status.

Goal: sub-agents authoring new workbooks self-serve the entire
capability discovery → declare → wire → ship loop without human
intervention.

---

## Open questions (resolve at impl time, not now)

- **Capability bundles** — can a "marketing-DR" composite declare
  itself as one slug that resolves a tuple (LLM + Brave + Drive)?
  Useful for skill-authoring shortcuts, opens scope-modeling
  complications. Defer to Phase 3+.
- **Local dev override** — should `workbook dev` allow injecting a
  local `.env.dev` that satisfies `call()` without round-tripping
  the broker? Yes for `env:*`; unclear for `oauth:*` (you'd have to
  paste a real OAuth token, which is sketchy). Decide in Phase 2.
- **Rotation** — what happens to in-flight workbooks when an admin
  rotates a key? Dispatch keeps working (proxy splices the new
  value from the rotated row); refs don't need to change. But
  `workbook capabilities probe` should call out "this capability was
  rotated since you last resolved — re-resolve to refresh hints."
- **Per-recipient scope** — Phase 2 binds dispatch to the viewer's
  bearer. Should there ever be a "use the AUTHOR's bearer" mode?
  Probably never — that's the BYOK-leakage anti-pattern we're
  trying to kill. Document as a non-goal.
- **Cost attribution** — every LLM call through the proxy can be
  metered. Per-workbook cost dashboards become trivial once
  Phase 2 is in. Out of scope for the resolver itself.

---

## Pointers

- Tracking: **wb-yufs.4** (parent epic **wb-yufs**).
- Related issues:
  - **wb-kd42** — Studio admin checklist UI; consumes resolve endpoint with `for: "dev"`.
  - **wb-yufs.9 (closed)** — v1 cleanup removed the obsolete `connectScopes[]` forward-compat shim.
  - **wb-yufs.10** — script-writer rebuild that proves the resolver works end-to-end.
- Existing code touchpoints:
  - `packages/workbooks/packages/workbook-cli/src/commands/connections.mjs` — the read-only `private / N groups / org` scope viewer we generalize.
  - `packages/workbooks/packages/workbook-cli/src/commands/env.mjs` — group env var CLI; merges into `capabilities` namespace under `env:*`.
  - `packages/workbooks/packages/workbook-cli/src/commands/publish.mjs:237` — `maybeWarnAboutUnmappedDatabases`; collapses into the unified resolve.
  - `packages/broker/worker/migrations/0009_group_env_vars.sql` — the secret storage; stays as-is.
  - `packages/broker/worker/src/routes/agents.ts:61` — `VALID_PROVIDERS` allowlist; reads from the catalog post-Phase-1.
- Three-nouns mental model: this is a property of **Groups** (the
  third noun). Workbooks and Agents declare what they need; Groups
  provide it. See `bd memories workbooks-three-nouns-mental-model`.
