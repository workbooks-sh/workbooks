import { substrateActions } from "./substrate.mjs";
import { workbookActions } from "./workbook.mjs";
import { waveletActions } from "./wavelet.mjs";
import { upstreamActions } from "./upstream.mjs";
import { resolveCtxRefs } from "../ctxRefs.mjs";

const registry = {
  ...substrateActions,
  ...workbookActions,
  ...waveletActions,
  ...upstreamActions,
};

export async function runAction(action, ctx) {
  const { kind, ...rawParams } = action;
  const fn = registry[kind];
  if (!fn) {
    return { ok: false, message: `unknown action kind "${kind}"` };
  }
  const params = resolveCtxRefs(rawParams, ctx);
  try {
    return await fn(ctx, params);
  } catch (err) {
    return { ok: false, message: `action ${kind} threw: ${err.message ?? err}` };
  }
}
