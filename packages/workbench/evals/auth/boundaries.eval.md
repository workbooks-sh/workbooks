---
name: auth/boundaries
agent: workhorse
turns:
  - checks:
      - kind: auth.http_expect
        url: "{eval.broker}/v1/agents/sessions/does-not-exist/poll?since=0"
        method: GET
        tokenSource: none
        expectStatus: 401
      - kind: auth.http_expect
        url: "{eval.broker}/git/{eval.foreignOrg}/repo.git/info/refs?service=git-upload-pack"
        method: GET
        tokenSource: bearer
        expectStatus: 403
      - kind: auth.http_expect
        url: "{eval.broker}/v1/agents/chat"
        method: POST
        tokenSource: expired
        body: '{"agentSlug":"workhorse","prompt":"noop"}'
        expectStatus: 401
      - kind: auth.http_expect
        url: "{eval.broker}/git/{eval.org}/repo.git/info/refs?service=git-receive-pack"
        method: GET
        tokenSource: readonly
        expectStatus: 403
---

# auth/boundaries

Four HTTP-level boundary tests against the broker. The eval contains
no chat turn — it's a check-only spec.

- 401 on a missing-token request to the polling endpoint
- 403 on a cross-org substrate read with a valid bearer (requires
  `eval.foreignOrg` in workbook.local.json — otherwise skipped)
- 401 on an expired-token chat-start (requires `eval.expiredTokenPath` —
  otherwise skipped)
- 403 on a git-receive-pack with a read-only token (requires
  `eval.readOnlyTokenPath` — otherwise skipped)

The skips are intentional: provisioning a foreign org and minting
expired/read-only tokens is operator setup, not framework code. The
checks become enforcing once the config knobs are populated.

## Operator setup to make all four assertions run

The last three checks soft-skip until `workbook.local.json` (under
`eval.*`) carries the right knobs. Run audits with `--require-all` to
promote any soft-skip to a hard fail — useful in CI / pre-release
gates where a green spec must mean every assertion actually fired.

Required keys:

- `eval.foreignOrg` — slug of a second org the bearer in
  `~/.config/workbooks/auth.json` is **not** a member of. Provision a
  throwaway org for this purpose; never reuse a real customer's org.
- `eval.expiredTokenPath` — path to a single-line file holding a
  bearer that has already expired. Mint via `workbook publish` against
  a short-TTL org or hand-craft a JWT with `exp` in the past, then
  store at e.g. `~/.config/workbooks/eval-expired.token`.
- `eval.readOnlyTokenPath` — path to a single-line file holding a
  bearer scoped read-only on `eval.org`. Issue via the broker's admin
  surface or scope an API key down before persisting.

Example `workbook.local.json`:

```json
{
  "eval": {
    "broker": "https://broker.workbooks.sh",
    "org": "workbooks-eval",
    "foreignOrg": "workbooks-eval-foreign",
    "expiredTokenPath": "/Users/me/.config/workbooks/eval-expired.token",
    "readOnlyTokenPath": "/Users/me/.config/workbooks/eval-readonly.token"
  }
}
```

Once those exist, `workbook-eval evals/auth/boundaries.eval.md
--require-all` will fail loudly if any single check is still skipping
for environmental reasons.
