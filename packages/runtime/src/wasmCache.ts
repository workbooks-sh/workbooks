/**
 * Content-addressed compile cache for WebAssembly modules.
 *
 * Workbooks bundle WASM payloads (Polars, Candle, SQLite, Rhai). Each
 * page load otherwise pays full `WebAssembly.compile()` cost. Browsers
 * support structured-clone of `WebAssembly.Module`, so we persist
 * compiled modules in IndexedDB keyed by SHA-256 of the source bytes —
 * cold loads on a returning visitor skip compile entirely.
 *
 * Consumers use this by feeding the result to wasm-bindgen's init:
 *
 *   const mod = await getCachedModule(wasmBytes);
 *   await wasm.default(mod);   // skips compile when Module is passed
 *
 * Browser minimums (structured clone of WebAssembly.Module):
 *   Chrome 76+, Firefox 68+, Safari 15+.
 *
 * Degradation: if IDB is unavailable, throws, or the browser refuses
 * structured-cloning a Module (some private-browsing modes), we fall
 * through to a direct `WebAssembly.compile` and log a single warning.
 */

const DB_NAME = "wb-wasm-cache";
const DB_VERSION = 1;
const STORE = "modules";
const META_STORE = "meta";
const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;

interface CacheEntry {
  hash: string;
  module: WebAssembly.Module;
  byteSize: number;
  lastAccessed: number;
}

export interface WasmCacheOptions {
  /** Source-byte budget in bytes. Default 256 MiB. */
  budgetBytes?: number;
  /** Override IDB factory for tests. Defaults to `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
  /** Override `WebAssembly.compile` for tests / instrumentation. */
  compile?: (bytes: Uint8Array) => Promise<WebAssembly.Module>;
  /** Override `crypto.subtle` for tests in stripped environments. */
  subtle?: SubtleCrypto;
}

let degraded = false;
let degradedReason = "";

function warnDegradedOnce(reason: string): void {
  if (degraded) return;
  degraded = true;
  degradedReason = reason;
  // eslint-disable-next-line no-console
  console.warn(`[wasmCache] degraded to compile-only: ${reason}`);
}

/** Reset the degradation flag — intended for tests. */
export function _resetDegradation(): void {
  degraded = false;
  degradedReason = "";
}

/** Expose degradation state for diagnostics / tests. */
export function isDegraded(): { degraded: boolean; reason: string } {
  return { degraded, reason: degradedReason };
}

async function sha256Hex(bytes: Uint8Array, subtle: SubtleCrypto): Promise<string> {
  const buf = await subtle.digest("SHA-256", bytes as BufferSource);
  const view = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb request failed"));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "hash" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb open failed"));
    req.onblocked = () => reject(new Error("idb open blocked"));
  });
}

async function idbGet(db: IDBDatabase, hash: string): Promise<CacheEntry | undefined> {
  const tx = db.transaction([STORE], "readonly");
  return promisifyRequest(tx.objectStore(STORE).get(hash) as IDBRequest<CacheEntry | undefined>);
}

async function idbPut(db: IDBDatabase, entry: CacheEntry): Promise<void> {
  const tx = db.transaction([STORE], "readwrite");
  await promisifyRequest(tx.objectStore(STORE).put(entry) as IDBRequest);
  await txDone(tx);
}

async function idbDelete(db: IDBDatabase, hash: string): Promise<void> {
  const tx = db.transaction([STORE], "readwrite");
  await promisifyRequest(tx.objectStore(STORE).delete(hash) as IDBRequest);
  await txDone(tx);
}

async function idbList(db: IDBDatabase): Promise<CacheEntry[]> {
  const tx = db.transaction([STORE], "readonly");
  const req = tx.objectStore(STORE).getAll() as IDBRequest<CacheEntry[]>;
  return promisifyRequest(req);
}

async function idbTouch(db: IDBDatabase, hash: string, lastAccessed: number): Promise<void> {
  const tx = db.transaction([STORE], "readwrite");
  const store = tx.objectStore(STORE);
  const existing = (await promisifyRequest(store.get(hash) as IDBRequest<CacheEntry | undefined>)) as
    | CacheEntry
    | undefined;
  if (existing) {
    existing.lastAccessed = lastAccessed;
    await promisifyRequest(store.put(existing) as IDBRequest);
  }
  await txDone(tx);
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("idb tx aborted"));
  });
}

async function evictToBudget(
  db: IDBDatabase,
  budgetBytes: number,
  pendingHash: string,
  pendingSize: number,
): Promise<void> {
  const entries = await idbList(db);
  let total = pendingSize;
  for (const e of entries) {
    if (e.hash !== pendingHash) total += e.byteSize;
  }
  if (total <= budgetBytes) return;
  const sortable = entries
    .filter((e) => e.hash !== pendingHash)
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  for (const e of sortable) {
    if (total <= budgetBytes) break;
    await idbDelete(db, e.hash);
    total -= e.byteSize;
  }
}

function pickSubtle(opts: WasmCacheOptions): SubtleCrypto | null {
  if (opts.subtle) return opts.subtle;
  const g = globalThis as typeof globalThis & { crypto?: Crypto };
  return g.crypto?.subtle ?? null;
}

function pickIdb(opts: WasmCacheOptions): IDBFactory | null {
  if (opts.indexedDB) return opts.indexedDB;
  const g = globalThis as typeof globalThis & { indexedDB?: IDBFactory };
  return g.indexedDB ?? null;
}

function pickCompile(opts: WasmCacheOptions): (b: Uint8Array) => Promise<WebAssembly.Module> {
  return opts.compile
    ? (b) => opts.compile!(b)
    : (b) => WebAssembly.compile(b as BufferSource);
}

/**
 * Get a compiled `WebAssembly.Module` for `bytes`, using the IDB cache
 * when available. Returns a fresh Module on every degraded path so
 * callers never have to branch on cache state.
 *
 * The IDB write happens asynchronously after the Module is returned —
 * cache misses don't block instantiation. A second concurrent call
 * with the same bytes may compile twice (the second write deduplicates
 * via keyPath); that's preferable to serializing all compiles behind
 * an in-flight lock.
 */
export async function getCachedModule(
  bytes: Uint8Array,
  opts: WasmCacheOptions = {},
): Promise<WebAssembly.Module> {
  const compile = pickCompile(opts);
  const subtle = pickSubtle(opts);
  const idb = pickIdb(opts);
  const budget = opts.budgetBytes ?? DEFAULT_BUDGET_BYTES;

  if (!subtle || !idb) {
    if (!degraded) {
      warnDegradedOnce(!subtle ? "SubtleCrypto unavailable" : "IndexedDB unavailable");
    }
    return compile(bytes);
  }

  let hash: string;
  try {
    hash = await sha256Hex(bytes, subtle);
  } catch (err) {
    warnDegradedOnce(`hash failed: ${(err as Error).message}`);
    return compile(bytes);
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openDb(idb);
    const hit = await idbGet(db, hash);
    if (hit) {
      const now = Date.now();
      void idbTouch(db, hash, now).catch(() => {});
      const mod = hit.module;
      return mod;
    }
  } catch (err) {
    warnDegradedOnce(`idb read failed: ${(err as Error).message}`);
    if (db) db.close();
    return compile(bytes);
  }

  const mod = await compile(bytes);
  const entry: CacheEntry = {
    hash,
    module: mod,
    byteSize: bytes.byteLength,
    lastAccessed: Date.now(),
  };
  const writeDb = db;
  void (async () => {
    try {
      await idbPut(writeDb, entry);
      await evictToBudget(writeDb, budget, hash, bytes.byteLength);
    } catch (err) {
      warnDegradedOnce(`idb write failed: ${(err as Error).message}`);
    } finally {
      writeDb.close();
    }
  })();
  return mod;
}

/** Drop every cached module. Intended for tests + manual invalidation. */
export async function clearCache(opts: WasmCacheOptions = {}): Promise<void> {
  const idb = pickIdb(opts);
  if (!idb) return;
  const db = await openDb(idb);
  try {
    const tx = db.transaction([STORE], "readwrite");
    await promisifyRequest(tx.objectStore(STORE).clear() as IDBRequest);
    await txDone(tx);
  } finally {
    db.close();
  }
}
