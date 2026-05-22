/**
 * Tests for the FS Access API persistence module. Run with:
 *
 *   npx tsx packages/workbooks/packages/runtime/src/stage/fsPersistence.test.ts
 *
 * Node doesn't have FileSystemFileHandle, DOMParser, or XMLSerializer
 * natively. We shim each with the smallest surface the module actually
 * consumes — an in-memory buffer for the file handle, and a tiny DOM
 * shim that matches the splice/extract behavior under test. The point
 * isn't full WHATWG compliance; it's verifying the script id, type,
 * data-slug, base64 payload, replace-vs-append, and permission gating.
 */

import assert from "node:assert/strict";
import * as YReal from "yjs";

(globalThis as unknown as { __wb_yjs: typeof YReal }).__wb_yjs = YReal;

class Node {
  childNodes: ElementShim[] = [];
  textContent = "";
}

class ElementShim extends Node {
  tagName: string;
  private _id = "";
  private attrs = new Map<string, string>();
  constructor(tag: string) {
    super();
    this.tagName = tag.toLowerCase();
  }
  get id() {
    return this._id;
  }
  set id(v: string) {
    this._id = v;
    this.attrs.set("id", v);
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
    if (k === "id") this._id = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs.has(k) ? this.attrs.get(k)! : null;
  }
  appendChild(el: ElementShim) {
    this.childNodes.push(el);
  }
  querySelector(sel: string): ElementShim | null {
    const m = /^([a-z]+)#([\w-]+)$/.exec(sel);
    if (!m) return null;
    const [, tag, id] = m;
    const walk = (n: ElementShim): ElementShim | null => {
      if (n.tagName === tag && n.id === id) return n;
      for (const c of n.childNodes) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  }
  get attributes(): Array<[string, string]> {
    return Array.from(this.attrs.entries());
  }
}

class DocumentShim {
  documentElement: ElementShim;
  head: ElementShim;
  body: ElementShim;
  constructor() {
    this.documentElement = new ElementShim("html");
    this.head = new ElementShim("head");
    this.body = new ElementShim("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) {
    return new ElementShim(tag);
  }
  querySelector(sel: string) {
    return this.documentElement.querySelector(sel);
  }
}

class DOMParserShim {
  parseFromString(html: string): DocumentShim {
    const doc = new DocumentShim();
    const headM = /<head>([\s\S]*?)<\/head>/i.exec(html);
    const bodyM = /<body>([\s\S]*?)<\/body>/i.exec(html);
    const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    const attrRe = /(\w[\w-]*)="([^"]*)"/g;
    const harvest = (region: string, into: ElementShim) => {
      let m: RegExpExecArray | null;
      while ((m = scriptRe.exec(region))) {
        const el = new ElementShim("script");
        let a: RegExpExecArray | null;
        attrRe.lastIndex = 0;
        while ((a = attrRe.exec(m[1]))) el.setAttribute(a[1], a[2]);
        el.textContent = m[2];
        into.appendChild(el);
      }
    };
    if (headM) harvest(headM[1], doc.head);
    if (bodyM) harvest(bodyM[1], doc.body);
    return doc;
  }
}

class XMLSerializerShim {
  serializeToString(node: ElementShim | DocumentShim): string {
    if (node instanceof DocumentShim) {
      return "<!doctype html>" + this.serializeElement(node.documentElement);
    }
    return this.serializeElement(node);
  }
  private serializeElement(el: ElementShim): string {
    const attrs = el.attributes.map(([k, v]) => ` ${k}="${v}"`).join("");
    const children = el.childNodes.map((c) => this.serializeElement(c)).join("");
    const inner = children || el.textContent || "";
    return `<${el.tagName}${attrs}>${inner}</${el.tagName}>`;
  }
}

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParserShim;
(globalThis as unknown as { XMLSerializer: unknown }).XMLSerializer = XMLSerializerShim;

class FakeWritable {
  constructor(private file: FakeFileHandle) {}
  async write(chunk: string) {
    this.file.contents = chunk;
  }
  async close() {
    /* no-op */
  }
}

class FakeFileHandle {
  contents: string;
  permission: PermissionState = "granted";
  constructor(initial: string) {
    this.contents = initial;
  }
  async getFile() {
    const text = this.contents;
    return { text: async () => text } as unknown as File;
  }
  async createWritable() {
    return new FakeWritable(this) as unknown as FileSystemWritableFileStream;
  }
  async queryPermission(_o: { mode: "read" | "readwrite" }): Promise<PermissionState> {
    return this.permission;
  }
  async requestPermission(_o: { mode: "read" | "readwrite" }): Promise<PermissionState> {
    return this.permission;
  }
}

const {
  spliceStateScript,
  extractStateScript,
  writeDocToFile,
  readDocFromFile,
  permissionState,
  isFileAccessSupported,
  requestFileAccess,
  PLAYGROUND_STATE_SCRIPT_ID,
  PLAYGROUND_STATE_SCRIPT_TYPE,
  __test,
} = await import("./fsPersistence.ts");

const Y = (await import("../yjsHost.ts")) as typeof import("../yjsHost");

function freshHtml(): string {
  return `<!doctype html><html><head><title>x</title></head><body><p>hi</p></body></html>`;
}

function testFeatureDetection() {
  // Node has neither showOpenFilePicker nor showSaveFilePicker on globalThis.
  assert.equal(isFileAccessSupported(), false, "node env reports unsupported");
  console.log("ok feature detection returns false in non-Chromium env");
}

async function testRequestFileAccessUnsupported() {
  const result = await requestFileAccess();
  assert.equal(result, null, "unsupported environment returns null, not throw");
  console.log("ok requestFileAccess returns null when API absent");
}

function testSpliceInsertsScript() {
  const out = spliceStateScript(freshHtml(), "demo", "QUJD");
  assert.ok(out.includes(`id="${PLAYGROUND_STATE_SCRIPT_ID}"`), "script id present");
  assert.ok(out.includes(`type="${PLAYGROUND_STATE_SCRIPT_TYPE}"`), "script type present");
  assert.ok(out.includes(`data-slug="demo"`), "slug attribute present");
  assert.ok(out.includes(">QUJD<"), "base64 payload embedded");
  console.log("ok splice inserts new state script");
}

function testSpliceReplacesExisting() {
  const first = spliceStateScript(freshHtml(), "demo", "QUJD");
  const second = spliceStateScript(first, "demo", "WFla");
  const matches = second.match(/id="wb-playground-state"/g) ?? [];
  assert.equal(matches.length, 1, "exactly one state script after replace");
  assert.ok(second.includes(">WFla<"), "payload updated");
  assert.ok(!second.includes(">QUJD<"), "old payload removed");
  console.log("ok splice replaces existing script (no duplicate)");
}

function testSpliceLeavesSourceBundleAlone() {
  const html = `<!doctype html><html><head><script id="wb-source-bundle" type="application/x-workbook-source">SOURCE_DATA</script></head><body></body></html>`;
  const out = spliceStateScript(html, "demo", "QUJD");
  assert.ok(out.includes(`id="wb-source-bundle"`), "source bundle preserved");
  assert.ok(out.includes("SOURCE_DATA"), "source bundle payload preserved");
  assert.ok(out.includes(`id="${PLAYGROUND_STATE_SCRIPT_ID}"`), "state script added alongside");
  console.log("ok splice leaves wb-source-bundle untouched");
}

function testExtractStateScript() {
  const html = spliceStateScript(freshHtml(), "demo", "QUJD");
  assert.equal(extractStateScript(html), "QUJD", "round-trip extract");
  assert.equal(extractStateScript(freshHtml()), null, "missing → null");
  console.log("ok extract state script payload");
}

async function testWriteDocToFile() {
  const handle = new FakeFileHandle(freshHtml()) as unknown as FileSystemFileHandle;
  const doc = new Y.Doc();
  doc.getMap("state").set("count", 7);
  const ok = await writeDocToFile(handle, doc, "demo");
  assert.equal(ok, true, "write succeeds with granted permission");
  const contents = (handle as unknown as FakeFileHandle).contents;
  assert.ok(contents.includes(`id="${PLAYGROUND_STATE_SCRIPT_ID}"`));
  const payload = extractStateScript(contents);
  assert.ok(payload, "payload extractable");
  assert.ok(payload!.length > 0, "non-empty base64");
  const reloaded = new Y.Doc();
  Y.applyUpdate(reloaded, __test.base64Decode(payload!));
  assert.equal(reloaded.getMap("state").get("count"), 7, "round-trip restores value");
  console.log("ok writeDocToFile embeds Y.doc update");
}

async function testReadDocFromFile() {
  const handle = new FakeFileHandle(freshHtml()) as unknown as FileSystemFileHandle;
  const writer = new Y.Doc();
  writer.getMap("state").set("answer", 42);
  await writeDocToFile(handle, writer, "demo");

  const reader = new Y.Doc();
  const found = await readDocFromFile(handle, reader);
  assert.equal(found, true);
  assert.equal(reader.getMap("state").get("answer"), 42, "state restored from file");

  const empty = await readDocFromFile(
    new FakeFileHandle(freshHtml()) as unknown as FileSystemFileHandle,
    new Y.Doc(),
  );
  assert.equal(empty, false, "no state in file → false");
  console.log("ok readDocFromFile round-trips state");
}

async function testPermissionDenied() {
  const handle = new FakeFileHandle(freshHtml());
  handle.permission = "denied";
  const result = await writeDocToFile(
    handle as unknown as FileSystemFileHandle,
    new Y.Doc(),
    "demo",
  );
  assert.equal(result, false, "denied permission → false, no throw");

  const probed = await permissionState(
    handle as unknown as FileSystemFileHandle,
    "readwrite",
    { request: true },
  );
  assert.equal(probed, "denied");
  console.log("ok permission denied returns false without throwing");
}

async function testPermissionLazyQuery() {
  const handle = new FakeFileHandle(freshHtml());
  let queryCount = 0;
  let requestCount = 0;
  const orig = handle.queryPermission.bind(handle);
  const origReq = handle.requestPermission.bind(handle);
  handle.queryPermission = async (o) => {
    queryCount++;
    return orig(o);
  };
  handle.requestPermission = async (o) => {
    requestCount++;
    return origReq(o);
  };
  await permissionState(handle as unknown as FileSystemFileHandle, "readwrite");
  assert.equal(queryCount, 1, "query called once");
  assert.equal(requestCount, 0, "request NOT called without {request:true}");
  console.log("ok permission probe is lazy");
}

testFeatureDetection();
await testRequestFileAccessUnsupported();
testSpliceInsertsScript();
testSpliceReplacesExisting();
testSpliceLeavesSourceBundleAlone();
testExtractStateScript();
await testWriteDocToFile();
await testReadDocFromFile();
await testPermissionDenied();
await testPermissionLazyQuery();

console.log("\nall fsPersistence tests passed");
