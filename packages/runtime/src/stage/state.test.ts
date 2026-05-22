/**
 * Tests for the stage Y.doc substrate. Run with:
 *
 *   npx tsx packages/workbooks/packages/runtime/src/stage/state.test.ts
 *
 * Exercises the deprecated `createPlaygroundDoc` / `connectToPlayground`
 * aliases so the back-compat path stays covered.
 *
 * The runtime resolves Yjs via `globalThis.__wb_yjs`; tests seed it
 * from the real `yjs` import. A mock postMessage bridge connects two
 * docs as if they lived in parent + child iframes.
 */

import assert from "node:assert/strict";
import * as YReal from "yjs";

(globalThis as unknown as { __wb_yjs: typeof YReal }).__wb_yjs = YReal;

// localStorage stub installed before importing the module under test.
const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => globalThis.Array.from(memStore.keys())[i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

// Counts localStorage.setItem calls per slug to verify throttling.
let setItemCalls = 0;
const origSet = globalThis.localStorage.setItem;
globalThis.localStorage.setItem = function (k: string, v: string) {
  setItemCalls++;
  origSet.call(this, k, v);
};

// Minimal window / iframe shims so state.ts can wire its listeners.
class MockWindow extends EventTarget {
  postedToOthers: Array<{ data: unknown; targetOrigin: string }> = [];
  peer: MockWindow | null = null;

  postMessage(data: unknown, targetOrigin: string) {
    this.postedToOthers.push({ data, targetOrigin });
    const ev = new Event("message") as Event & { data: unknown; source: unknown };
    ev.data = data;
    ev.source = this.peer ?? undefined;
    this.dispatchEvent(ev);
  }
}

// state.ts uses the global `window`; we route it to a controllable instance.
const hostWin = new MockWindow();
const childWin = new MockWindow();
hostWin.peer = childWin;
childWin.peer = hostWin;

(globalThis as unknown as { window: MockWindow }).window = hostWin;

class MockIframe {
  contentWindow: MockWindow = childWin;
  contentDocument = { readyState: "complete" as const };
  private listeners = new Map<string, Array<EventListener>>();
  addEventListener(type: string, fn: EventListener) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: EventListener) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  fireLoad() {
    for (const fn of this.listeners.get("load") ?? []) fn(new Event("load"));
  }
}

const { createPlaygroundDoc } = await import("./state.ts");
const { connectToPlayground } = await import("./client.ts");

// The client opts in to a parent connection when `window.parent !== window`.
// We swap `window` for the child for the duration of client setup, then
// restore.
function withChildWindow<T>(fn: () => T): T {
  (globalThis as unknown as { window: MockWindow }).window = childWin;
  // give client.ts something to recognize as a parent
  (childWin as unknown as { parent: MockWindow; top: MockWindow }).parent = hostWin;
  (childWin as unknown as { parent: MockWindow; top: MockWindow }).top = hostWin;
  try {
    return fn();
  } finally {
    (globalThis as unknown as { window: MockWindow }).window = hostWin;
  }
}

async function tick(ms = 0) {
  await new Promise((r) => setTimeout(r, ms));
}

async function testHostToChildAndBack() {
  memStore.clear();
  setItemCalls = 0;
  const iframe = new MockIframe();
  const host = createPlaygroundDoc("test-a", iframe as unknown as HTMLIFrameElement);
  const client = withChildWindow(() => connectToPlayground());

  // both sides exchange initial sync-step-1 → sync-step-2
  await tick(0);

  host.doc.getMap("state").set("count", 1);
  await tick(0);
  assert.equal(client.doc.getMap("state").get("count"), 1, "host write reaches client");

  client.doc.getMap("state").set("name", "hello");
  await tick(0);
  assert.equal(host.doc.getMap("state").get("name"), "hello", "client write reaches host");

  host.destroy();
  client.destroy();
  console.log("ok host<->client convergence");
}

async function testPersistence() {
  memStore.clear();
  setItemCalls = 0;
  const iframe = new MockIframe();
  const host = createPlaygroundDoc("test-persist", iframe as unknown as HTMLIFrameElement);
  host.doc.getMap("state").set("answer", 42);
  await tick(1100); // wait past the 1s throttle window
  host.destroy();

  // recreate, persistence should restore
  const iframe2 = new MockIframe();
  const host2 = createPlaygroundDoc("test-persist", iframe2 as unknown as HTMLIFrameElement);
  assert.equal(host2.doc.getMap("state").get("answer"), 42, "value restored from localStorage");
  host2.destroy();
  console.log("ok persistence round-trip");
}

async function testThrottle() {
  memStore.clear();
  setItemCalls = 0;
  const iframe = new MockIframe();
  const host = createPlaygroundDoc("test-throttle", iframe as unknown as HTMLIFrameElement);

  for (let i = 0; i < 100; i++) {
    host.doc.getMap("state").set("v", i);
  }
  await tick(1100);

  // 100 rapid writes should produce at most a couple persist calls
  // (one trailing edge from the throttle window).
  assert.ok(setItemCalls <= 3, `expected <=3 storage writes, got ${setItemCalls}`);
  assert.ok(setItemCalls >= 1, `expected >=1 storage write, got ${setItemCalls}`);
  host.destroy();
  console.log(`ok throttling (${setItemCalls} writes for 100 mutations)`);
}

async function testStandaloneClient() {
  // No parent — connectToPlayground returns a local-only doc.
  const standaloneWin = new MockWindow();
  (standaloneWin as unknown as { parent: MockWindow; top: MockWindow }).parent = standaloneWin;
  (standaloneWin as unknown as { parent: MockWindow; top: MockWindow }).top = standaloneWin;
  (globalThis as unknown as { window: MockWindow }).window = standaloneWin;
  try {
    const c = connectToPlayground();
    c.doc.getMap("state").set("solo", true);
    assert.equal(c.doc.getMap("state").get("solo"), true);
    c.destroy();
    console.log("ok standalone client degrades to local-only");
  } finally {
    (globalThis as unknown as { window: MockWindow }).window = hostWin;
  }
}

await testHostToChildAndBack();
await testPersistence();
await testThrottle();
await testStandaloneClient();
console.log("\nall stage state tests passed");
