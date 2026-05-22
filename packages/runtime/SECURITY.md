# Runtime security model

Read this before shipping credentials inside a workbook, and before
running a workbook authored by someone else.

## Core threat model

**Workbooks are untrusted code.** A `.html` artifact is a portable
program written by its author — same trust posture as an npm script,
a Chrome extension, or a SaaS marketing site you sign into. The
runtime SDK can't tell who authored a workbook; sandboxing limits
blast radius but **credentials inside the iframe are reachable by
the author's code**.

That mental model drives every concrete rule below. If something
feels surprising, it's because workbooks LOOK like static HTML but
behave like applications.

## What sandboxing buys you

Workbooks run in cross-origin iframes with a CSP. That means:

- A workbook can't read another workbook's `localStorage` /
  `IndexedDB` / cookies (cross-origin barrier).
- A workbook can't see the host page's DOM or scripts.
- postMessage is the only cross-frame channel; the host validates
  every envelope it accepts.

That's still meaningful — a malicious workbook can't escalate to
"read the user's GitHub PAT from Studio." But it doesn't mean the
author can't see whatever the author's own code is allowed to see.

## What sandboxing does NOT buy you

- **Credentials passed INTO the workbook are reachable by the
  workbook's code.** When Studio posts `wb:bind:database` with a
  Supabase anon key, the author's code can read it. Same for any
  toolkit credential.
- **The runtime SDK doesn't enforce "tools have certain permissions."**
  A workbook with declared `tools: ["forecast"]` and `tools:
  ["read_user_email"]` has the same runtime privileges — both are
  just functions in the bundle.

## Concrete rules for authors

1. **Never bake service-role / admin keys into a workbook.** The
   CLI's `--bake-public-db` refuses Supabase JWTs with
   `role:"service_role"` (see `cli/util/localCreds.mjs`). RLS is
   the security boundary — design schemas so the anon role can only
   read/write what the workbook needs.

2. **`--embed-private` is for self-use only.** It bakes live
   credentials with no checks, stamps a banner into the artifact,
   and emits a console warning at boot. Don't redistribute these
   artifacts.

3. **Templates ship without credentials.** `workbook build
   --template` (wb-gnf.1) refuses both `--bake-public-db` and
   `--embed-private`, strips author from the manifest, and asserts
   the output has no `wb-databases-baked` tag. Use it for
   fork-this-workbook flows.

## Concrete rules for recipients

1. **Open connected workbooks in a host you trust.** Production
   builds that declare `databases:` refuse to run when opened
   directly off `file://` — they render a takeover splash pointing
   at the configured host. That's intentional: cross-host hops
   should be deliberate.

2. **Anon keys are public by design.** Seeing a Supabase URL +
   anon key inside a `.html` is not a leak. RLS does the work. If
   a workbook fails to authenticate against your schema, the fix is
   on the RLS side, not the workbook side.

3. **Service-role-shaped tokens are leaks.** If you decode a JWT
   from inside a workbook and it has `role:"service_role"` or
   equivalent admin claims, the author shipped a real secret. Don't
   run it. Tell them.

## What changed in wb-x8g (2026-05-16)

Older versions of the runtime had a `localStorage` path: when no
host bound a credential, a first-run modal asked the recipient to
paste a URL + key. We removed both. Connected workbooks in
production now refuse to run without a host. Templates without
baked credentials open in Studio. This dropped four credential-
handling surfaces (slug-collision localStorage keys, the modal
itself, write-back to localStorage, and the panel's input
validation gap) — none of them exist anymore.

The narrower model: **one credential resolution path = host
postMessage; if there's no host, the workbook either has baked
credentials (intentional) or refuses to run (intentional).**

## Reporting

Found a runtime surface that contradicts this doc? File at
github.com/workbooks-sh/workbooks. For undisclosed-vuln
reporting, email security@workbooks.sh.
