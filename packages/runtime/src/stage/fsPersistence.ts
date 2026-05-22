/**
 * File System Access API persistence for the playground.
 *
 * When the user picks (or opens) a local `.html` workbook, we ask for
 * write access and round-trip Y.doc state into a dedicated
 * `<script id="wb-playground-state">` tag inside that file. The script
 * `type` is `application/x-playground-state` so browsers never try to
 * execute it — zero runtime impact on the wrapped workbook.
 *
 * Why DOMParser + serializeToString instead of string-splicing the
 * `<head>`: the wrapped file may already contain `<script id="wb-source-bundle">`
 * (the W1 source-embed pivot), a workbook-spec block, and arbitrary
 * inline scripts. A regex/slice approach has to dodge all of them
 * correctly; DOMParser does it for free and is plenty fast at the
 * single-file scale we operate on (workbooks land in the low MB range).
 * Cost is one parse + one serialize per save, paid at 1 Hz max.
 *
 * Browser support: Chromium-family only (Chrome, Edge, Brave, Opera,
 * Arc). Safari + Firefox don't implement FS Access API as of 2026-05.
 * The caller MUST feature-detect via `isFileAccessSupported()` and hide
 * UI when false — every public function here returns null/false rather
 * than throwing when the API is missing.
 */
declare const showOpenFilePicker: ((opts?: unknown) => Promise<FileSystemFileHandle[]>) | undefined;
declare const showSaveFilePicker: ((opts?: unknown) => Promise<FileSystemFileHandle> | undefined) | undefined;

import * as Y from "../yjsHost";

export const PLAYGROUND_STATE_SCRIPT_ID = "wb-playground-state";
export const PLAYGROUND_STATE_SCRIPT_TYPE = "application/x-playground-state";

export type PermissionMode = "read" | "readwrite";
export type PermissionResult = "granted" | "denied" | "prompt" | "unsupported";

export function isFileAccessSupported(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    "showOpenFilePicker" in (globalThis as Record<string, unknown>) &&
    "showSaveFilePicker" in (globalThis as Record<string, unknown>)
  );
}

const HTML_TYPES = {
  description: "Workbook HTML",
  accept: { "text/html": [".html", ".htm"] as const },
};

export interface RequestFileAccessOptions {
  mode?: "open" | "save";
  suggestedName?: string;
}

/**
 * Prompt the user to pick a local `.html` workbook. Resolves with
 * `null` on cancel, on permission denial, or on browsers without the
 * API. Never throws — the playground stays in localStorage mode if
 * this returns null.
 */
export async function requestFileAccess(
  opts: RequestFileAccessOptions = {},
): Promise<FileSystemFileHandle | null> {
  if (!isFileAccessSupported()) return null;
  const mode = opts.mode ?? "open";
  try {
    if (mode === "save") {
      const fn = (globalThis as Record<string, unknown>).showSaveFilePicker as
        | ((p: unknown) => Promise<FileSystemFileHandle>)
        | undefined;
      if (!fn) return null;
      return await fn({
        suggestedName: opts.suggestedName ?? "workbook.html",
        types: [HTML_TYPES],
      });
    }
    const fn = (globalThis as Record<string, unknown>).showOpenFilePicker as
      | ((p: unknown) => Promise<FileSystemFileHandle[]>)
      | undefined;
    if (!fn) return null;
    const handles = await fn({ multiple: false, types: [HTML_TYPES] });
    return handles[0] ?? null;
  } catch (e) {
    if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") return null;
    return null;
  }
}

/**
 * Probe + (lazily) request readwrite permission. We avoid calling
 * `requestPermission` until the moment we need it because browsers
 * surface a prompt every time the user has revoked access since the
 * last grant. Cheap `queryPermission` first, request only if needed.
 */
export async function permissionState(
  handle: FileSystemFileHandle,
  mode: PermissionMode = "readwrite",
  { request = false }: { request?: boolean } = {},
): Promise<PermissionResult> {
  const h = handle as unknown as {
    queryPermission?: (o: { mode: PermissionMode }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: PermissionMode }) => Promise<PermissionState>;
  };
  if (!h.queryPermission) return "unsupported";
  const state = await h.queryPermission({ mode });
  if (state === "granted") return "granted";
  if (!request) return state === "denied" ? "denied" : "prompt";
  if (!h.requestPermission) return "unsupported";
  const next = await h.requestPermission({ mode });
  if (next === "granted") return "granted";
  return next === "denied" ? "denied" : "prompt";
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

interface ParserLike {
  parseFromString(html: string, type: string): Document;
}

interface SerializerLike {
  serializeToString(node: Node): string;
}

function getParser(): ParserLike {
  return new (globalThis as unknown as { DOMParser: new () => ParserLike }).DOMParser();
}

function getSerializer(): SerializerLike {
  return new (globalThis as unknown as { XMLSerializer: new () => SerializerLike }).XMLSerializer();
}

/**
 * Splice (or replace) the playground-state script in `html` so it
 * carries the given base64-encoded Y.doc update. Exported for tests;
 * the public file writer composes parse + splice + write.
 */
export function spliceStateScript(html: string, slug: string, base64: string): string {
  const parser = getParser();
  const doc = parser.parseFromString(html, "text/html");
  let script = doc.querySelector(`script#${PLAYGROUND_STATE_SCRIPT_ID}`) as HTMLScriptElement | null;
  if (script) {
    script.setAttribute("type", PLAYGROUND_STATE_SCRIPT_TYPE);
    script.setAttribute("data-slug", slug);
    script.textContent = base64;
  } else {
    script = doc.createElement("script") as HTMLScriptElement;
    script.id = PLAYGROUND_STATE_SCRIPT_ID;
    script.setAttribute("type", PLAYGROUND_STATE_SCRIPT_TYPE);
    script.setAttribute("data-slug", slug);
    script.textContent = base64;
    const head = doc.head ?? doc.querySelector("head") ?? doc.documentElement;
    head.appendChild(script);
  }
  return getSerializer().serializeToString(doc);
}

/** Pull the embedded state script's base64 payload, or null if absent. */
export function extractStateScript(html: string): string | null {
  const parser = getParser();
  const doc = parser.parseFromString(html, "text/html");
  const script = doc.querySelector(`script#${PLAYGROUND_STATE_SCRIPT_ID}`);
  if (!script) return null;
  const body = script.textContent ?? "";
  const trimmed = body.trim();
  return trimmed === "" ? null : trimmed;
}

async function readFileText(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return await file.text();
}

async function writeFileText(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

/**
 * Serialize `doc` and embed it into the file backing `handle`. Returns
 * false if permission isn't granted or the write fails — the caller
 * uses that signal to fall back to localStorage.
 */
export async function writeDocToFile(
  handle: FileSystemFileHandle,
  doc: Y.Doc,
  slug: string,
): Promise<boolean> {
  const perm = await permissionState(handle, "readwrite", { request: true });
  if (perm !== "granted") return false;
  try {
    const html = await readFileText(handle);
    const bytes = Y.encodeStateAsUpdate(doc);
    const next = spliceStateScript(html, slug, base64Encode(bytes));
    await writeFileText(handle, next);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply any state embedded in the file into `doc`. Returns true if
 * state was found and applied. Tolerates missing/garbled state — the
 * playground just continues with whatever state it loaded elsewhere.
 */
export async function readDocFromFile(
  handle: FileSystemFileHandle,
  doc: Y.Doc,
): Promise<boolean> {
  const perm = await permissionState(handle, "read", { request: true });
  if (perm !== "granted") return false;
  try {
    const html = await readFileText(handle);
    const payload = extractStateScript(html);
    if (!payload) return false;
    Y.applyUpdate(doc, base64Decode(payload), "file");
    return true;
  } catch {
    return false;
  }
}

export const __test = {
  base64Encode,
  base64Decode,
};
