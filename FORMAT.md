# Workbook Format

This document defines the **portable workbook standard** — what every
workbook artifact must be, regardless of who built it or which host
runs it. It is the contract that lets a workbook authored in
Workbooks Studio open and run inside Anthropic Studio, an internal
corp Studio, the workbooks.sh hosted viewer, or directly off
`file://`.

The goal is decoupling: the *format* is the standard; the *host* is
an implementation. New hosts conform to this contract without
coordinating with workbooks.sh.

For internal architecture detail (Rust runtime, broker, Convex
schema), see [`docs/SPEC.md`](docs/SPEC.md). This document is the
public surface.

---

## Artifact

A workbook is **one self-contained `.html` file**. Recipients open it
in any browser — `file://`, hosted, or embedded as an iframe.
Filename is irrelevant; the runtime reads embedded `<script>` blocks
to identify itself.

| Constraint | Why |
|---|---|
| One HTML file, no external assets | Email-safe, USB-safe, file-system portable |
| Untrusted code by default | The runtime can't tell who authored a workbook; cross-origin iframe + CSP at the boundary |
| Identity via inline `<script>` blocks, not filename | Survives renames, `foo (1).html` collisions, MIME-sniff hosts |

---

## Universal manifest

Every workbook declares its shape and dependencies in
`workbook.config.mjs` (author surface) — the CLI bakes these into
`<script>` blocks the host reads at boot.

### Required

| Field | Type | Description |
|---|---|---|
| `slug` | `string` (kebab-case) | Stable identifier within an author / org scope |
| `entry` | `string` | Path to entry HTML, relative to config root |
| `type` | `"document" \| "notebook" \| "spa" \| "presentation" \| "agent"` | Rendering profile — see [Shapes](#shapes) |

### Optional (universal)

| Field | Type | Description |
|---|---|---|
| `databases` | `{ [slot]: { kind: "supabase" \| "convex" \| "turso" } }` | Browser-safe DB slots the workbook needs; resolved per-recipient at runtime |
| `integrations` | `string[]` | Composio toolkit slugs the workbook calls (`gmail`, `github`, …) |
| `tools` | `{ [name]: { description, input } }` | MCP-style tool declarations exposed to agents |
| `connect` | `{ [key]: { … } }` | Env-style declarations resolved via the host's secret store |
| `host` | `{ name?, url?, splashColor?, logoSvg? }` | Optional host pointer — see [Host extensibility](#host-extensibility) |
| `wasm` | `{ strategy: "bundle" \| "reference", cdnBaseUrl?, variant? }` | WASM strategy; default `"bundle"` preserves portability. `"reference"` fetches from `cdnBaseUrl/<variant>/{bindgen.js,runtime.wasm,bundle.js}` at boot |

### Host-emitted manifest blocks

The CLI translates the config into these `<script>` blocks. Hosts
read them; authors do not write them directly.

```html
<script id="workbook-spec"     type="application/json">{ slug, title, … }</script>
<script id="wb-databases"      type="application/x-workbook-databases">[ {name, kind}, … ]</script>
<script id="wb-databases-baked" type="application/x-workbook-databases-baked">{ slot: {url, key} }</script>
<script id="wb-capabilities"   type="application/x-workbook-capabilities">[ … ]</script>
<script id="wb-integrations"   type="application/x-workbook-integrations">[ "slug", … ]</script>
<script id="wb-host"           type="application/x-workbook-host">{ name, url, splashColor, logoSvg }</script>
<script id="wb-wasm-refs"      type="application/x-workbook-wasm-refs">{ baseUrl, variant }</script>
<script id="wb-source-bundle"  type="application/x-workbook-source">BASE64...</script>
<meta   name="wb-build-mode"   content="production|dev">
```

Hosts MUST read by `id`, never by tag position. Unknown `<script>`
blocks are ignored — extension via new ids, never via shape changes
to existing ones.

---

## Shapes

`type` selects a rendering profile. Same format, same runtime
contract, same `wb.*` SDK — different chrome.

| `type` | Surface |
|---|---|
| `document` | Read-mostly prose + auto-rendered blocks (charts, tables, citations) |
| `notebook` | Linear runner with cells in a reactive DAG |
| `spa` | Author renders its own UI; runtime is a service available on demand |
| `presentation` | Fixed-aspect slide narrative with creative slide HTML |
| `agent` | Renderable preview card; the actual agent runs server-side, parameterised by the embedded `wb-agent` JSON |

A host MAY ignore shapes it doesn't render (e.g., a minimal host
that only handles `spa`). It MUST NOT remap a shape silently —
shape semantics are part of the contract.

---

## Runtime SDK

Inside the workbook (post-load), author code interacts with the host
through a small surface:

```ts
import { wb, floater, connections, rpc } from "@work.books/runtime";

wb.text(id, opts)          // char-level CRDT text
wb.collection(id, opts)    // whole-record-replace list
wb.value(id, opts)         // last-write-wins single value
wb.db(slot)                // browser-safe DB handle (Supabase/Convex/Turso)

floater.add(item)          // surface a "needs attention" item to the host
floater.remove(id)
floater.dismiss(id)

connections.execute(toolkit, action, args)  // Composio-aggregated integrations

rpc.register(toolName, handler)        // expose a local tool handler
rpc.call(toolName, args)                // call cross-workbook (or local)
rpc.setFallback(fn)                     // configure HTTP MCP fallback
```

The SDK assumes nothing about the host. All host interaction goes
through [the postMessage handshakes](#host-handshake).

---

## Host handshake

Two postMessage protocols. A workbook in an iframe initiates; the
host responds. Top-level / file:// workbooks see no responses and
fall through to their built-in fallbacks.

### Database binding

```
workbook  →  host:   { type: "wb:request:database", slots: [{name, kind}, …] }
host      →  workbook: { type: "wb:bind:database", slot, credentials: { url, key } }
```

The host resolves each declared slot per-recipient (group default,
per-workbook override, per-user pinning) and posts the credentials
back. Slots with no resolution are left unbound — workbook code sees
a `WbDatabaseNeedsConfig` error in dev or a takeover splash in
production (see [Studio-required policy](#studio-required-policy)).

### Floater

```
workbook  →  host:   { type: "wb:floater:hello" }
host      →  workbook: { type: "wb:floater:ack" }      (within 250ms)
workbook  →  host:   { type: "wb:floater:add",    item: FloaterItem }
workbook  →  host:   { type: "wb:floater:remove", id:   string }
```

A host that responds with `wb:floater:ack` within 250ms takes over
the floater surface — the workbook forwards items instead of
self-rendering. Hosts that ignore the hello get the workbook's
built-in plain-DOM widget.

`FloaterItem`:
```ts
{ id: string; label: string; cta: string; href: string;
  glyph?: string; tone?: "info" | "warn"; }
```

### Cross-workbook tool RPC

```
workbook  →  host:    { type: "wb:rpc:hello" }
host      →  workbook: { type: "wb:rpc:ack" }                  (within 250ms)
workbook  →  host:    { type: "wb:rpc:expose",
                        workbookSlug: string, tools: RpcToolDecl[] }
caller    →  host:    { type: "wb:rpc:list", listId: string }
host      →  caller:  { type: "wb:rpc:list:result", listId: string,
                        tools: Array<RpcToolDecl & { workbookSlug }> }
caller    →  host:    { type: "wb:rpc:call",
                        callId: string, toolName: string,
                        args: Record<string, unknown> }
host      →  owner:   { type: "wb:rpc:call",  callId: "bus:<id>", … }
owner     →  host:    { type: "wb:rpc:result", callId: "bus:<id>",
                        ok: boolean, result?: unknown,
                        error?: { code: string, message: string } }
host      →  caller:  { type: "wb:rpc:result", callId: <original>, … }
```

When two workbooks are co-resident under the same host (Studio
canvas, hosted viewer with multiple embeds), tool calls between them
route through the host bus instead of the broker MCP endpoint. The
workbook that owns a tool registers it via `wb:rpc:expose` after
acking; subsequent calls flow caller → host → owner → host → caller.

`wb:rpc:list` returns every tool the bus can route, scoped by the
host's policy (typical: same-workgroup membership). Discovery is a
first-class operation — workbooks SHOULD list before they call when
the set of available tools is unknown.

A standalone workbook (top-level frame or no responsive host) has no
bus — calls to non-local tools throw `WbRpcNoRoute` unless author
code configures a fallback transport via `rpc.setFallback()`.
`rpc.listTools()` in standalone mode returns only declared local
tools.

**Host responsibilities**:

- Refuse `wb:rpc:call` envelopes that cross workgroup boundaries.
  The caller's source `Window` identifies which workbook is calling;
  the host owns the (`source Window` → `workbookId` → `groupId`)
  table and uses it to enforce scope. Reply with
  `error: { code: "out_of_scope", message: ... }`.
- Pre-populate the routing table with the workbook's identity (id,
  group) when creating each iframe — do NOT trust the workbook's
  self-reported `workbookSlug` for authorization.
- Ack `wb:rpc:hello` within 250ms or the workbook falls back to
  standalone mode.

**Error codes** (in `wb:rpc:result`):

| Code | Meaning |
|---|---|
| `no_handler` | Tool not in the routing table |
| `out_of_scope` | Caller and owner are in different workgroups |
| `route_gone` | Owning iframe disappeared between expose and call |
| `handler_error` | Owner's handler threw |
| `timeout` | Owner didn't reply within the caller's timeout |
| `parent_gone` | Host postMessage target unreachable |

`RpcToolDecl`:
```ts
{ name: string; description?: string }
```

---

## Studio-required policy

A workbook with declared `databases` and `wb-build-mode = production`
that opens with no host (top-level frame, no postMessage response)
renders a **takeover splash** instead of running. The runtime
replaces `document.body` with a redirect card pointing at the host
in `<script id="wb-host">` (or `studio.workbooks.sh` if not set).

This is the contract for "connected workbooks." A workbook that
doesn't declare any external connections has nothing to redirect for
and runs anywhere.

Dev builds (`wb-build-mode = dev`) skip the splash and throw
`WbDatabaseNeedsConfig` so HMR isn't hijacked.

---

## Host extensibility

The optional `host` block lets any team brand the takeover splash,
floater, and "open in Studio" CTAs for their own Studio
implementation:

```js
// workbook.config.mjs
export default {
  slug: "acme-report", entry: "src/index.html", type: "document",
  databases: { main: { kind: "supabase" } },
  host: {
    name: "Acme Studio",
    url: "https://studio.acme.example",
    splashColor: "#d97706",
    logoSvg: "<svg ...>",
  },
};
```

Omitted → runtime falls back to `workbooks.sh` defaults.

The host pointer is **advisory metadata**, not enforcement — a
recipient can always open the workbook through any other compatible
host. The pointer just tells the runtime which "open in Studio"
URL to use when no host responds at boot.

---

## Source bundle

The CLI gzips the project source tree into the artifact for
recipient inspection:

```html
<script id="wb-source-bundle"
        type="application/x-workbook-source"
        data-format="json+gzip+base64"
        data-version="1">BASE64...</script>
```

`workbook unbundle <file.html> <dir/>` recovers the tree. Default ON
for unencrypted builds; `--no-bundle` opts out.

The `type` attribute deliberately is **not** `application/javascript`
— browsers ignore non-script types entirely, so the embedded data
has zero parse cost at load.

---

## Versioning

| Field | Where | Compat rule |
|---|---|---|
| `data-version` on each `<script id="wb-*">` | the script tag itself | Hosts MUST tolerate unknown future versions by ignoring the block |
| `workbook-spec.version` | manifest body | Semver; minor versions add fields without breaking older hosts |

New `wb-*` ids are how the format extends. Removing or repurposing
an existing id is a breaking change requiring a major version bump
in the runtime SDK.

---

## What's NOT in this format

These belong to specific hosts, not the standard:

- **User identity / sign-in** — each host owns its own auth surface.
- **Per-recipient state** — hosts persist this however they like
  (Convex, Postgres, browser-local).
- **Pricing / billing** — workbooks.sh handles this on its viewer;
  other hosts do their own.
- **Discovery / marketplace** — a host concern, not the artifact's.
- **Publication / signing** — a future addendum (see
  [`docs/SIGNING.md`](docs/SIGNING.md)) but not load-bearing for
  the format today.

---

## References

- Runtime SDK source: [`packages/runtime/src/`](packages/runtime/src/)
- CLI source: [`packages/workbook-cli/src/`](packages/workbook-cli/src/)
- Internal architecture: [`docs/SPEC.md`](docs/SPEC.md)
- Security model (full doc): [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md)
- Runtime security threat model + author rules: [`packages/runtime/SECURITY.md`](packages/runtime/SECURITY.md)
