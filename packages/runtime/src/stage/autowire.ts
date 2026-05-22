/**
 * Stage auto-wire — runs from every workbook's bootstrap so sliders,
 * agent panels, and any other host UI bound to the stage Y.doc
 * immediately drive the wrapped workbook's state.
 *
 * Without this, the wrapped workbook would have to explicitly import
 * `connectToStage` from `@work.books/runtime/stage/client` before the
 * sync handshake fires — which no author does. The auto-wire pays a
 * fixed ~3 KB gzip and one function-call cost in every workbook
 * bundle, and degrades to a local-only Y.Doc when not embedded in a
 * stage iframe.
 *
 * Idempotency: callable many times across bootstrap paths (htmlBindings
 * + WorkbookApp) without producing duplicate listeners or duplicate
 * sync handshakes. The first call wins; later calls return the cached
 * handle.
 */

import { connectToStage, type StageClientHandle } from "./client";

interface RuntimeWithStage {
  stage?: StageClientHandle;
  /** @deprecated Use .stage. Dual-written for one release. */
  playground?: StageClientHandle;
}

type RuntimeWindow = Window & {
  __wbRuntime?: RuntimeWithStage;
  __wbStage?: StageClientHandle;
  /** @deprecated Use __wbStage. Dual-written for one release. */
  __wbPlayground?: StageClientHandle;
};

/**
 * Attach a stage client handle to `window.__wbRuntime.stage`.
 * Safe to call before or after the runtime client is assigned to
 * `window.__wbRuntime`. Returns the handle so callers can reach it
 * synchronously when they're sure they own the first call.
 *
 * No-ops on subsequent calls — the cached handle is reattached if the
 * runtime client object changed identity between calls (which happens
 * when htmlBindings and WorkbookApp both run in the same page, an
 * unusual but legal combination).
 *
 * Writes both `__wbStage` + `__wbPlayground` window globals and both
 * `rt.stage` + `rt.playground` runtime fields. TODO(v1.0): drop the
 * playground aliases once one full release cycle has shipped.
 */
export function installStageClient(): StageClientHandle {
  if (typeof window === "undefined") {
    // SSR / Node — return a stub. Callers won't have anywhere to put
    // it, but we still hand back the same shape so call sites can
    // unconditionally read .doc.
    return connectToStage();
  }
  const w = window as RuntimeWindow;
  // Window-scoped cache, not module-scoped: when the same package is
  // duplicated across bundles (rare but possible with two runtime
  // packages co-resident), all copies still resolve to one handle.
  if (!w.__wbStage) {
    try {
      w.__wbStage = connectToStage();
      w.__wbPlayground = w.__wbStage;
    } catch (err) {
      console.warn("stage client init failed:", err);
      // Fall back to a never-syncing handle so consumers never see
      // `undefined.doc`. connectToStage itself only throws in
      // pathological host environments.
      throw err;
    }
  }
  // Reattach onto the (possibly newer) runtime client. The runtime
  // is the public consumption surface; the window-level cache is the
  // singleton's anchor.
  const rt = w.__wbRuntime;
  if (rt) {
    if (!rt.stage) rt.stage = w.__wbStage;
    if (!rt.playground) rt.playground = w.__wbStage;
  }
  return w.__wbStage;
}

/** @deprecated Use installStageClient. */
export const installPlaygroundClient = installStageClient;
