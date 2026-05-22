/**
 * Tests for the WebAssembly compile cache. Run with:
 *
 *   npx tsx packages/runtime/src/wasmCache.test.ts
 *
 * Uses an in-memory IDB stub (no `fake-indexeddb` dep) that implements
 * just the surface `wasmCache.ts` touches: open, get, put, delete,
 * getAll, clear, plus the request/transaction event plumbing.
 */

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  getCachedModule,
  clearCache,
  isDegraded,
  _resetDegradation,
  type WasmCacheOptions,
} from "./wasmCache.ts";

type StoredRecord = { hash: string; module: object; byteSize: number; lastAccessed: number };

interface FakeReq<T> {
  result: T;
  error: Error | null;
  onsuccess: ((this: FakeReq<T>) => void) | null;
  onerror: ((this: FakeReq<T>) => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

function makeReq<T>(): FakeReq<T> {
  return {
    result: undefined as unknown as T,
    error: null,
    onsuccess: null,
    onerror: null,
  };
}

function settle<T>(req: FakeReq<T>, result: T | Error): void {
  queueMicrotask(() => {
    if (result instanceof Error) {
      req.error = result;
      req.onerror?.call(req);
    } else {
      req.result = result;
      req.onsuccess?.call(req);
    }
  });
}

interface FakeTx {
  store: Map<string, StoredRecord>;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: Error | null;
  pending: number;
  done: boolean;
  objectStore(_name: string): FakeStore;
}

interface FakeStore {
  get(key: string): FakeReq<StoredRecord | undefined>;
  put(value: StoredRecord): FakeReq<unknown>;
  delete(key: string): FakeReq<unknown>;
  getAll(): FakeReq<StoredRecord[]>;
  clear(): FakeReq<unknown>;
}

function makeTx(store: Map<string, StoredRecord>): FakeTx {
  let oncomplete: (() => void) | null = null;
  const tx: FakeTx = {
    store,
    get oncomplete() {
      return oncomplete;
    },
    set oncomplete(fn) {
      oncomplete = fn;
      if (tx.done && fn) queueMicrotask(() => fn());
    },
    onerror: null,
    onabort: null,
    error: null,
    pending: 0,
    done: false,
    objectStore(_name: string) {
      return makeStore(tx);
    },
  } as FakeTx;
  return tx;
}

function trackOp<T>(tx: FakeTx, req: FakeReq<T>, result: T): FakeReq<T> {
  tx.pending++;
  settle(req, result);
  queueMicrotask(() => {
    tx.pending--;
    if (tx.pending === 0 && !tx.done) {
      tx.done = true;
      tx.oncomplete?.();
    }
  });
  return req;
}

function makeStore(tx: FakeTx): FakeStore {
  return {
    get(key) {
      const req = makeReq<StoredRecord | undefined>();
      return trackOp(tx, req, tx.store.get(key));
    },
    put(value) {
      const req = makeReq<unknown>();
      tx.store.set(value.hash, value);
      return trackOp(tx, req, value.hash);
    },
    delete(key) {
      const req = makeReq<unknown>();
      tx.store.delete(key);
      return trackOp(tx, req, undefined);
    },
    getAll() {
      const req = makeReq<StoredRecord[]>();
      return trackOp(tx, req, Array.from(tx.store.values()));
    },
    clear() {
      const req = makeReq<unknown>();
      tx.store.clear();
      return trackOp(tx, req, undefined);
    },
  };
}

interface FakeDb {
  closed: boolean;
  objectStoreNames: { contains(name: string): boolean };
  transaction(_names: string[], _mode: string): FakeTx;
  createObjectStore(name: string, _opts: unknown): void;
  close(): void;
}

function makeFactory(): {
  factory: IDBFactory;
  reset(): void;
  storeSize(): number;
  dropDb(): void;
} {
  const stores = new Map<string, Map<string, StoredRecord>>();
  let dbDropped = false;
  const ensureStore = (name: string): Map<string, StoredRecord> => {
    let s = stores.get(name);
    if (!s) {
      s = new Map();
      stores.set(name, s);
    }
    return s;
  };
  const factory = {
    open(_name: string, _version?: number) {
      const req = makeReq<FakeDb>() as FakeReq<FakeDb> & {
        onupgradeneeded?: (() => void) | null;
      };
      const created = new Set<string>();
      const db: FakeDb = {
        closed: false,
        objectStoreNames: { contains: (n) => created.has(n) || stores.has(n) },
        transaction(names) {
          if (dbDropped) throw new Error("db dropped");
          const name = names[0];
          return makeTx(ensureStore(name));
        },
        createObjectStore(name) {
          created.add(name);
          ensureStore(name);
        },
        close() {
          this.closed = true;
        },
      };
      queueMicrotask(() => {
        if (req.onupgradeneeded) {
          req.result = db;
          req.onupgradeneeded.call(req);
        }
        req.result = db;
        req.onsuccess?.call(req);
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    reset() {
      stores.clear();
      dbDropped = false;
    },
    storeSize() {
      return ensureStore("modules").size;
    },
    dropDb() {
      dbDropped = true;
    },
  };
}

function fakeModule(tag: string): WebAssembly.Module {
  return { __tag: tag } as unknown as WebAssembly.Module;
}

function bytesOf(seed: number, size: number): Uint8Array {
  const a = new Uint8Array(size);
  for (let i = 0; i < size; i++) a[i] = (seed + i) & 0xff;
  return a;
}

async function wait(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTests(): Promise<void> {
  const subtle = (webcrypto as Crypto).subtle;

  // --- Test 1: cache hit dedupes compile ---
  {
    _resetDegradation();
    const { factory } = makeFactory();
    let compiles = 0;
    const opts: WasmCacheOptions = {
      indexedDB: factory,
      subtle,
      compile: async (b) => {
        compiles++;
        return fakeModule(`m-${(b as Uint8Array).byteLength}`);
      },
    };
    const bytes = bytesOf(1, 64);
    const m1 = await getCachedModule(bytes, opts);
    await wait();
    const m2 = await getCachedModule(bytes, opts);
    assert.equal(compiles, 1, "same bytes should compile once");
    assert.ok(m1, "first compile produced a module");
    assert.ok(m2, "second call returned a module");
    console.log("ok cache hit dedupes compile");
  }

  // --- Test 2: different bytes compile independently ---
  {
    _resetDegradation();
    const { factory } = makeFactory();
    let compiles = 0;
    const opts: WasmCacheOptions = {
      indexedDB: factory,
      subtle,
      compile: async () => {
        compiles++;
        return fakeModule(`m-${compiles}`);
      },
    };
    await getCachedModule(bytesOf(1, 64), opts);
    await wait();
    await getCachedModule(bytesOf(2, 64), opts);
    await wait();
    await getCachedModule(bytesOf(3, 64), opts);
    assert.equal(compiles, 3, "distinct bytes → distinct compiles");
    console.log("ok different bytes compile independently");
  }

  // --- Test 3: cache survives open→close→open cycle ---
  {
    _resetDegradation();
    const { factory } = makeFactory();
    let compiles = 0;
    const opts: WasmCacheOptions = {
      indexedDB: factory,
      subtle,
      compile: async () => {
        compiles++;
        return fakeModule(`m-${compiles}`);
      },
    };
    const bytes = bytesOf(9, 64);
    await getCachedModule(bytes, opts);
    await wait(20);
    await getCachedModule(bytes, opts);
    await wait(20);
    await getCachedModule(bytes, opts);
    assert.equal(compiles, 1, "persistent cache hits across open cycles");
    console.log("ok cache survives reopen cycle");
  }

  // --- Test 4: LRU eviction past budget ---
  {
    _resetDegradation();
    const helper = makeFactory();
    const opts: WasmCacheOptions = {
      indexedDB: helper.factory,
      subtle,
      budgetBytes: 200,
      compile: async (b) => fakeModule(`m-${(b as Uint8Array).byteLength}`),
    };
    await getCachedModule(bytesOf(1, 100), opts);
    await wait(50);
    await getCachedModule(bytesOf(2, 100), opts);
    await wait(50);
    await getCachedModule(bytesOf(3, 100), opts);
    await wait(300);
    const size = helper.storeSize();
    assert.ok(size <= 2, `expected ≤2 entries after eviction, got ${size}`);
    console.log("ok LRU evicts to budget");
  }

  // --- Test 5: IDB unavailable degrades cleanly ---
  {
    _resetDegradation();
    let compiles = 0;
    const opts: WasmCacheOptions = {
      indexedDB: undefined,
      subtle,
      compile: async () => {
        compiles++;
        return fakeModule("nocache");
      },
    };
    const m = await getCachedModule(bytesOf(1, 64), opts);
    assert.ok(m, "fallback path returns module");
    assert.equal(compiles, 1);
    assert.equal(isDegraded().degraded, true);
    console.log("ok degrades when IDB unavailable");
  }

  // --- Test 6: IDB throws on open → degrades and returns Module ---
  {
    _resetDegradation();
    const throwingFactory = {
      open() {
        const req = makeReq<unknown>();
        queueMicrotask(() => {
          req.error = new Error("simulated open failure");
          req.onerror?.call(req);
        });
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    let compiles = 0;
    const opts: WasmCacheOptions = {
      indexedDB: throwingFactory,
      subtle,
      compile: async () => {
        compiles++;
        return fakeModule("fallback");
      },
    };
    const m = await getCachedModule(bytesOf(1, 64), opts);
    assert.ok(m);
    assert.equal(compiles, 1);
    assert.equal(isDegraded().degraded, true);
    console.log("ok degrades when IDB open throws");
  }

  // --- Test 7: clearCache wipes entries ---
  {
    _resetDegradation();
    const helper = makeFactory();
    const opts: WasmCacheOptions = {
      indexedDB: helper.factory,
      subtle,
      compile: async () => fakeModule("c"),
    };
    await getCachedModule(bytesOf(1, 32), opts);
    await wait(20);
    assert.ok(helper.storeSize() >= 1);
    await clearCache({ indexedDB: helper.factory });
    assert.equal(helper.storeSize(), 0);
    console.log("ok clearCache empties store");
  }

  console.log("\nall wasmCache tests passed");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
