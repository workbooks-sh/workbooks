/**
 * Tests for the stage auto-wire helper. Run with:
 *
 *   npx tsx packages/workbooks/packages/runtime/src/stage/autowire.test.ts
 *
 * The auto-wire is the bridge that fires `connectToStage()` from
 * every runtime bootstrap without authors needing to import anything.
 * Exercises the deprecated `installPlaygroundClient` /
 * `connectToPlayground` / `createPlaygroundDoc` aliases so the
 * back-compat path stays covered.
 * Three things to prove:
 *
 *   1. Standalone (no parent window) — returns a local-only doc, no
 *      errors, no postMessage activity.
 *   2. Embedded (mock parent that responds to sync) — wrapped doc
 *      converges with parent's state.
 *   3. Idempotency — repeat calls return the same handle, don't stack
 *      message listeners.
 *
 * Mirrors state.test.ts mocking pattern: real `yjs` seeded into
 * `globalThis.__wb_yjs`, MockWindow + paired peers for postMessage.
 */

import assert from "node:assert/strict";
import * as YReal from "yjs";

(globalThis as unknown as { __wb_yjs: typeof YReal }).__wb_yjs = YReal;

class MockWindow extends EventTarget {
  peer: MockWindow | null = null;

  // Same shape as state.test.ts: the message is dispatched on the
  // *callee's* window, with `source` set to the peer that sent it.
  // host.iframe.contentWindow.postMessage(...) means "deliver to the
  // child's window listeners; the sender (source) is the host."
  postMessage(data: unknown, _targetOrigin: string) {
    const ev = new Event("message") as Event & { data: unknown; source: unknown };
    ev.data = data;
    ev.source = this.peer ?? undefined;
    this.dispatchEvent(ev);
  }
}

const hostWin = new MockWindow();
const childWin = new MockWindow();
hostWin.peer = childWin;
childWin.peer = hostWin;

(globalThis as unknown as { window: MockWindow }).window = hostWin;

const { createPlaygroundDoc } = await import("./state.ts");
const { connectToPlayground } = await import("./client.ts");
const { installPlaygroundClient } = await import("./autowire.ts");

function withChildWindow<T>(fn: () => T): T {
  (globalThis as unknown as { window: MockWindow }).window = childWin;
  (childWin as unknown as { parent: MockWindow; top: MockWindow }).parent = hostWin;
  (childWin as unknown as { parent: MockWindow; top: MockWindow }).top = hostWin;
  try {
    return fn();
  } finally {
    (globalThis as unknown as { window: MockWindow }).window = hostWin;
  }
}

function withStandaloneWindow<T>(fn: () => T): T {
  const solo = new MockWindow();
  (solo as unknown as { parent: MockWindow; top: MockWindow }).parent = solo;
  (solo as unknown as { parent: MockWindow; top: MockWindow }).top = solo;
  (globalThis as unknown as { window: MockWindow }).window = solo;
  try {
    return fn();
  } finally {
    (globalThis as unknown as { window: MockWindow }).window = hostWin;
  }
}

function tick(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

// Stub iframe for the host side.
class MockIframe {
  contentWindow: MockWindow;
  contentDocument = { readyState: "complete" as const };
  private listeners = new Map<string, Array<EventListener>>();
  constructor(target: MockWindow) {
    this.contentWindow = target;
  }
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
}

function clearWindowCache(w: MockWindow) {
  delete (w as unknown as { __wbPlayground?: unknown }).__wbPlayground;
  delete (w as unknown as { __wbRuntime?: unknown }).__wbRuntime;
}

async function testStandaloneNoErrors() {
  let handle: { doc: YReal.Doc; destroy: () => void } | null = null;
  let threw: unknown = null;
  withStandaloneWindow(() => {
    try {
      handle = installPlaygroundClient();
    } catch (e) {
      threw = e;
    }
  });
  assert.equal(threw, null, "no errors when standalone");
  assert.ok(handle, "handle returned");
  assert.ok(handle!.doc instanceof YReal.Doc, "doc is a Y.Doc");
  // Verify local write works on the local-only doc.
  handle!.doc.getMap("state").set("k", 1);
  assert.equal(handle!.doc.getMap("state").get("k"), 1);
  handle!.destroy();
  console.log("ok standalone: returns local-only doc, no errors");
}

async function testEmbeddedConvergence() {
  // Host side: create a playground doc bound to the (mock) iframe.
  const iframe = new MockIframe(childWin);
  const host = createPlaygroundDoc("autowire-embedded", iframe as unknown as HTMLIFrameElement);

  // Child side: the auto-wire fires `connectToPlayground`.
  clearWindowCache(childWin);
  const handle = withChildWindow(() => installPlaygroundClient());

  await tick(0);

  // Write on the host, read on the child.
  host.doc.getMap("state").set("from-host", "ok");
  await tick(0);
  assert.equal(handle.doc.getMap("state").get("from-host"), "ok", "host write reaches child");

  // Write on the child, read on the host.
  handle.doc.getMap("state").set("from-child", "yep");
  await tick(0);
  assert.equal(host.doc.getMap("state").get("from-child"), "yep", "child write reaches host");

  handle.destroy();
  host.destroy();
  console.log("ok embedded: doc converges with host's state");
}

async function testIdempotency() {
  clearWindowCache(childWin);
  let a: ReturnType<typeof installPlaygroundClient> | null = null;
  let b: ReturnType<typeof installPlaygroundClient> | null = null;
  withChildWindow(() => {
    a = installPlaygroundClient();
    b = installPlaygroundClient();
  });
  assert.strictEqual(a, b, "repeated installs return the same handle");
  a!.destroy();
  console.log("ok idempotency: repeated installs share one handle");
}

async function testAttachesToRuntime() {
  clearWindowCache(childWin);
  const fakeRuntime: { playground?: unknown } = {};
  (childWin as unknown as { __wbRuntime: typeof fakeRuntime }).__wbRuntime = fakeRuntime;
  withChildWindow(() => {
    installPlaygroundClient();
  });
  assert.ok(fakeRuntime.playground, "playground handle attached to __wbRuntime");
  const handle = fakeRuntime.playground as { doc: YReal.Doc; destroy: () => void };
  assert.ok(handle.doc instanceof YReal.Doc, "exposed handle has a Y.Doc");
  handle.destroy();
  console.log("ok exposes handle on window.__wbRuntime.playground");
}

async function testNoEnvelopesWhenStandalone() {
  // Standalone client doesn't even subscribe to messages, so we
  // can't directly observe postMessage; instead, prove that destroy()
  // is safe and the doc is the *local* one (writes don't propagate
  // to any peer because there is no peer).
  let handle: { doc: YReal.Doc; destroy: () => void } | null = null;
  withStandaloneWindow(() => {
    clearWindowCache((globalThis as unknown as { window: MockWindow }).window);
    handle = installPlaygroundClient();
  });
  // Set a value, then ensure it doesn't appear on hostWin's listeners.
  let saw = false;
  const onAny = () => { saw = true; };
  hostWin.addEventListener("message", onAny);
  handle!.doc.getMap("state").set("solo", true);
  await tick(20);
  hostWin.removeEventListener("message", onAny);
  assert.equal(saw, false, "standalone write does not leak to other windows");
  handle!.destroy();
  console.log("ok standalone: zero postMessage traffic");
}

await testStandaloneNoErrors();
await testEmbeddedConvergence();
await testIdempotency();
await testAttachesToRuntime();
await testNoEnvelopesWhenStandalone();
console.log("\nall stage autowire tests passed");
