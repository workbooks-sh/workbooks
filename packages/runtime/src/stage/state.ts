/**
 * Y.doc state substrate for the stage host side.
 *
 * The stage host owns the canonical Y.Doc. The wrapped workbook
 * connects to it via postMessage (see client.ts for the wrapped side).
 * Both sides converge through the canonical Yjs sync handshake: each
 * side announces its state vector (sync-step-1), the peer responds
 * with the delta the other is missing (sync-step-2), and subsequent
 * `update` events propagate live changes. The 3-message protocol is
 * inlined here over `Y.encodeStateVector` + `Y.encodeStateAsUpdate(doc,
 * stateVector)` rather than pulling in `y-protocols/sync`, since the
 * postMessage envelope is already structured — no need for lib0 varint
 * framing.
 *
 * State is persisted in localStorage keyed by stage slug. Writes
 * are throttled to ~1 Hz so slider drags don't thrash storage.
 *
 * Wire-protocol field `wb_playground` stays on the envelope: host and
 * client live in separate artifacts (outer + wrapped), so renaming the
 * flag would desync stages embedded in workbooks built across the
 * boundary. TODO(v1.0): bump to `wb_stage` once one full release cycle
 * has shipped with both names recognized.
 */

import * as Y from "../yjsHost";
import { readDocFromFile, writeDocToFile } from "./fsPersistence";

const ENVELOPE_FLAG = 1 as const;
const STORAGE_PREFIX = "wb.playground.doc";
const PERSIST_INTERVAL_MS = 1000;

type SyncMessageType = "sync-step-1" | "sync-step-2" | "update";

interface StageEnvelope {
  wb_playground: typeof ENVELOPE_FLAG;
  type: SyncMessageType;
  payload: Uint8Array;
}

export interface StageDocHandle {
  doc: Y.Doc;
  destroy(): void;
  attachFile(handle: FileSystemFileHandle): Promise<void>;
  detachFile(): void;
  hasFile(): boolean;
}

/** @deprecated Use StageDocHandle. */
export type PlaygroundDocHandle = StageDocHandle;

function isEnvelope(data: unknown): data is StageEnvelope {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.wb_playground !== ENVELOPE_FLAG) return false;
  if (d.type !== "sync-step-1" && d.type !== "sync-step-2" && d.type !== "update") return false;
  return d.payload instanceof Uint8Array;
}

function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}.${slug}`;
}

function loadPersisted(slug: string, doc: Y.Doc): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return;
    const bytes = base64Decode(raw);
    Y.applyUpdate(doc, bytes);
  } catch {
    /* malformed or unavailable storage — start fresh */
  }
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Create the host-side stage doc bound to a child iframe.
 *
 * The host kicks off the handshake by posting sync-step-1 to the child
 * as soon as the child signals readiness (it sends its own sync-step-1
 * once loaded). We tolerate either side initiating — both directions
 * are symmetric in the y-protocols sync algorithm.
 */
export interface CreateStageDocOptions {
  fileHandle?: FileSystemFileHandle;
}

/** @deprecated Use CreateStageDocOptions. */
export type CreatePlaygroundDocOptions = CreateStageDocOptions;

export function createStageDoc(
  slug: string,
  iframeEl: HTMLIFrameElement,
  options: CreateStageDocOptions = {},
): StageDocHandle {
  const doc = new Y.Doc();
  loadPersisted(slug, doc);

  let destroyed = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let fileHandle: FileSystemFileHandle | undefined = options.fileHandle;
  let fileFallbackWarned = false;
  let fileWriteInFlight = false;
  let pendingFileWrite = false;

  const persistToLocalStorage = () => {
    try {
      if (typeof localStorage === "undefined") return;
      const bytes = Y.encodeStateAsUpdate(doc);
      localStorage.setItem(storageKey(slug), base64Encode(bytes));
    } catch {
      /* quota or private mode — drop */
    }
  };

  const persistToFile = async () => {
    if (!fileHandle) return;
    if (fileWriteInFlight) {
      pendingFileWrite = true;
      return;
    }
    fileWriteInFlight = true;
    try {
      const ok = await writeDocToFile(fileHandle, doc, slug);
      if (!ok) {
        if (!fileFallbackWarned) {
          fileFallbackWarned = true;
          console.warn(
            "[wb-stage] file persistence unavailable; falling back to localStorage",
          );
        }
        fileHandle = undefined;
        persistToLocalStorage();
      }
    } finally {
      fileWriteInFlight = false;
      if (pendingFileWrite && !destroyed) {
        pendingFileWrite = false;
        void persistToFile();
      }
    }
  };

  const schedulePersist = () => {
    if (destroyed || persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (fileHandle) {
        void persistToFile();
      } else {
        persistToLocalStorage();
      }
    }, PERSIST_INTERVAL_MS);
  };

  const sendToChild = (type: SyncMessageType, payload: Uint8Array) => {
    const target = iframeEl.contentWindow;
    if (!target) return;
    const envelope: StageEnvelope = { wb_playground: ENVELOPE_FLAG, type, payload };
    target.postMessage(envelope, "*");
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== iframeEl.contentWindow) return;
    if (!isEnvelope(ev.data)) return;
    const msg = ev.data;
    if (msg.type === "sync-step-1") {
      const diff = Y.encodeStateAsUpdate(doc, msg.payload);
      sendToChild("sync-step-2", diff);
      sendToChild("sync-step-1", Y.encodeStateVector(doc));
    } else if (msg.type === "sync-step-2" || msg.type === "update") {
      Y.applyUpdate(doc, msg.payload, "remote");
    }
  };

  const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    schedulePersist();
    if (origin === "remote") return;
    sendToChild("update", update);
  };

  doc.on("update", onLocalUpdate);
  window.addEventListener("message", onMessage);

  const initiate = () => {
    if (destroyed) return;
    sendToChild("sync-step-1", Y.encodeStateVector(doc));
  };

  if (iframeEl.contentDocument?.readyState === "complete") {
    initiate();
  } else {
    iframeEl.addEventListener("load", initiate, { once: true });
  }

  if (fileHandle) {
    void readDocFromFile(fileHandle, doc).catch(() => false);
  }

  return {
    doc,
    async attachFile(handle: FileSystemFileHandle) {
      fileHandle = handle;
      fileFallbackWarned = false;
      const restored = await readDocFromFile(handle, doc).catch(() => false);
      if (!restored) schedulePersist();
    },
    detachFile() {
      fileHandle = undefined;
    },
    hasFile() {
      return fileHandle !== undefined;
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("message", onMessage);
      doc.off("update", onLocalUpdate);
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      doc.destroy();
    },
  };
}

/** @deprecated Use createStageDoc. */
export const createPlaygroundDoc = createStageDoc;

export const __test = {
  isEnvelope,
  storageKey,
  base64Encode,
  base64Decode,
  PERSIST_INTERVAL_MS,
};
