/**
 * Stage client — y.doc sync from inside the wrapped workbook.
 *
 * Mirror of state.ts on the embedded side. The wrapped workbook imports
 * `connectToStage()` to opt into shared state. If the workbook is
 * loaded standalone (no parent frame), it returns a local-only doc with
 * no transport — same API, just no sync.
 *
 * The host always seeds persistence; the client just plays back what
 * arrives from the parent over postMessage. We don't persist on the
 * client side to avoid divergent stores per origin.
 *
 * Wire-protocol field `wb_playground` stays on the envelope: host and
 * client live in separate artifacts, so renaming the flag would desync
 * stages embedded across the old/new build boundary. TODO(v1.0): bump
 * to `wb_stage` once one full release cycle has shipped with both
 * names recognized.
 */

import * as Yreal from "yjs";
import * as Y from "../yjsHost";

// The autowire path makes every workbook a potential stage client,
// even when the host bundle hasn't seeded __wb_yjs. Seed it ourselves so
// the lazy yjsHost lookup resolves to our bundled yjs.
if (typeof globalThis !== "undefined" && !(globalThis as { __wb_yjs?: unknown }).__wb_yjs) {
  (globalThis as { __wb_yjs?: unknown }).__wb_yjs = Yreal;
}

const ENVELOPE_FLAG = 1 as const;

type SyncMessageType = "sync-step-1" | "sync-step-2" | "update";

interface StageEnvelope {
  wb_playground: typeof ENVELOPE_FLAG;
  type: SyncMessageType;
  payload: Uint8Array;
}

export interface StageClientHandle {
  doc: Y.Doc;
  destroy(): void;
}

/** @deprecated Use StageClientHandle. */
export type PlaygroundClientHandle = StageClientHandle;

function isEnvelope(data: unknown): data is StageEnvelope {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.wb_playground !== ENVELOPE_FLAG) return false;
  if (d.type !== "sync-step-1" && d.type !== "sync-step-2" && d.type !== "update") return false;
  return d.payload instanceof Uint8Array;
}

export function connectToStage(): StageClientHandle {
  const doc = new Y.Doc();

  const embedded = typeof window !== "undefined" && window.top !== window && window.parent !== window;
  if (!embedded) {
    return {
      doc,
      destroy: () => doc.destroy(),
    };
  }

  const parent = window.parent;

  const sendToParent = (type: SyncMessageType, payload: Uint8Array) => {
    const envelope: StageEnvelope = { wb_playground: ENVELOPE_FLAG, type, payload };
    parent.postMessage(envelope, "*");
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== parent) return;
    if (!isEnvelope(ev.data)) return;
    const msg = ev.data;
    if (msg.type === "sync-step-1") {
      const diff = Y.encodeStateAsUpdate(doc, msg.payload);
      sendToParent("sync-step-2", diff);
    } else if (msg.type === "sync-step-2" || msg.type === "update") {
      Y.applyUpdate(doc, msg.payload, "remote");
    }
  };

  const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    sendToParent("update", update);
  };

  // Respond to params-probe requests from the stage host. The host's
  // cross-origin fetch of the wrapped URL is blocked when its iframe has
  // origin:null (hosted viewer sandbox). PostMessage works regardless.
  const PARAMS_FLAG = "wb_playground_params" as const;
  const readScriptJson = (id: string): unknown => {
    if (typeof document === "undefined") return null;
    const el = document.getElementById(id);
    if (!el || el.tagName !== "SCRIPT") return null;
    try { return JSON.parse(el.textContent ?? "null"); } catch { return null; }
  };
  const onParamsRequest = (ev: MessageEvent) => {
    const d = ev.data;
    if (!d || (d as { [k: string]: unknown })[PARAMS_FLAG] !== 1) return;
    if ((d as { type?: unknown }).type !== "request") return;
    const payload = {
      tools: readScriptJson("wb-capabilities"),
      params: readScriptJson("wb-params"),
    };
    const target = ev.source as Window | null;
    target?.postMessage({ [PARAMS_FLAG]: 1, type: "response", payload }, "*");
  };

  doc.on("update", onLocalUpdate);
  window.addEventListener("message", onMessage);
  window.addEventListener("message", onParamsRequest);

  sendToParent("sync-step-1", Y.encodeStateVector(doc));

  return {
    doc,
    destroy() {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("message", onParamsRequest);
      doc.off("update", onLocalUpdate);
      doc.destroy();
    },
  };
}

/** @deprecated Use connectToStage. */
export const connectToPlayground = connectToStage;
