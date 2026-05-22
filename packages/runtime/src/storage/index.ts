/**
 * `wb.*` — author-facing storage SDK for workbooks.
 *
 * Three primitives, each backed by a Yjs shared type under the hood.
 * Authors don't see Yjs; they see "applied storage concepts":
 *
 *   wb.text(id, opts)        char-level merge (prose, source code)
 *   wb.collection(id, opts)  whole-record-replace list, keyed by .id
 *   wb.value(id, opts)       single object/scalar, last-write-wins
 *
 * All three primitives share a common contract:
 *
 *   • `.value` (or `.list`) is a synchronous getter for the current
 *     snapshot; safe to read before mount finishes (returns "" / [] /
 *     `default` until the doc resolves).
 *   • `.subscribe(fn)` registers a listener; fires once with the
 *     current value on registration so consumers don't need a
 *     separate "read initial" call. Returns an unsubscribe fn.
 *   • Mutations call `doc.commit()` so the host's autosave layer
 *     (which subscribes to local commits → IDB / disk) sees the
 *     change. The SDK never schedules its own persistence.
 *   • Pre-mount writes are queued and replayed once the doc resolves.
 */

import { createText, type WbText, type WbTextOptions } from "./text";
import { createCollection, type WbCollection, type WbCollectionOptions, type WbRecord } from "./collection";
import { createValue, type WbValue, type WbValueOptions } from "./value";
import { createDb, type WbDatabase } from "./db";
import { installListener as installDbBindingListener } from "./dbBinding";
import { getLogos, type LogoMap } from "../logos";

// Fire the binding listener + eager-splash check at SDK load so the
// "this workbook needs Studio" takeover renders before any author
// code that lazily calls wb.db(...).
installDbBindingListener();

export const wb = {
  text(id: string, opts?: WbTextOptions): WbText {
    return createText(id, opts);
  },
  collection<T extends WbRecord = WbRecord>(
    id: string,
    opts?: WbCollectionOptions,
  ): WbCollection<T> {
    return createCollection<T>(id, opts);
  },
  value<T = unknown>(id: string, opts?: WbValueOptions<T>): WbValue<T> {
    return createValue<T>(id, opts);
  },
  /** Browser-safe database slot (Supabase / Convex / Turso). Slot
   *  must be declared in workbook.config.mjs > databases. Credentials
   *  resolve via Studio postMessage, localStorage, or a baked anon
   *  config — see ./dbBinding.ts. */
  db(slot: string): WbDatabase {
    return createDb(slot);
  },
  /** Brand logos baked at build time. Access via
   *  `wb.logos.<as>.dataUrl` or `.svg`. Returns an empty map when
   *  no logos were declared. See ../logos.ts and workbook.config.mjs
   *  `logos` field. */
  get logos(): LogoMap {
    return getLogos();
  },
};

export type {
  WbText,
  WbTextOptions,
  WbCollection,
  WbCollectionOptions,
  WbRecord,
  WbValue,
  WbValueOptions,
};

// Database SDK — slot-based, browser-safe, BYO connector.
export { WbDatabaseError } from "./db";
export type { WbDatabase, DbCredentials, DbKind } from "./db";
export {
  WbDatabaseNeedsConfig,
  WbConnectedWorkbookRequiresStudio,
} from "./dbBinding";

// Hydration gate — re-exported here so hosts that only consume the
// storage subpath (no Svelte components, no yjs sidecar) can still
// signal "WAL apply is done; seed-on-empty primitives may proceed."
export { markDocHydrated, awaitHydration } from "./bootstrap";
