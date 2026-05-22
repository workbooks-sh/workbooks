// Check registry. Each check kind is keyed by a dotted string
// ("session.text_contains") and receives ({ events, sessionId, spec }, params).
// Future namespaces: substrate.*, xsurface.*, auth.* — wb-p4t2.3/5/6.

import { sessionChecks } from "./session.mjs";
import { substrateChecks } from "./substrate.mjs";
import { authChecks } from "./auth.mjs";
import { rubricChecks } from "./rubric.mjs";
import { mcpChecks } from "./mcp.mjs";
import { waveletChecks } from "./wavelet.mjs";
import { pollChecks } from "./poll.mjs";
import { workbookActions } from "../actions/workbook.mjs";
import { waveletActions } from "../actions/wavelet.mjs";
import { upstreamActions } from "../actions/upstream.mjs";
import { resolveCtxRefs } from "../ctxRefs.mjs";

const registry = {
  ...sessionChecks,
  ...substrateChecks,
  ...authChecks,
  ...rubricChecks,
  ...mcpChecks,
  ...waveletChecks,
  ...pollChecks,
  // workbook.build / wavelet.commercial (and friends) are registered in both
  // registries: as checks (failure fails the eval) and as actions (callable
  // from setup/cleanup). Same signature, same semantics.
  ...workbookActions,
  ...waveletActions,
  ...upstreamActions,
};

export async function runCheck(check, ctx) {
  const { kind, ...rawParams } = check;
  const fn = registry[kind];
  if (!fn) {
    return { ok: false, message: `unknown check kind "${kind}"` };
  }
  const params = resolveCtxRefs(rawParams, ctx);
  try {
    return await fn(ctx, params);
  } catch (err) {
    return { ok: false, message: `check ${kind} threw: ${err.message ?? err}` };
  }
}
