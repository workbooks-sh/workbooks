/**
 * Tests for the auto-generated effects panel. Run with:
 *
 *   npx tsx packages/workbooks/packages/runtime/src/stage/effectsPanel.test.ts
 *
 * The Svelte component itself isn't mounted (no jsdom in the runtime
 * test harness) — instead, we exercise the pure dispatch + fetch+parse
 * helpers extracted into effectsSchema.ts, plus a Y.doc round-trip
 * that mirrors what the component does in onMount.
 */

import assert from "node:assert/strict";
import * as YReal from "yjs";

(globalThis as unknown as { __wb_yjs: typeof YReal }).__wb_yjs = YReal;

import type { Tool } from "./effectsSchema.ts";

const {
  dispatchControl,
  groupsFromTools,
  groupFromParams,
  parseCapabilitiesFromHtml,
  parseParamsFromHtml,
} = await import("./effectsSchema.ts");

const Y = (await import("../yjsHost.ts")) as unknown as typeof import("../yjsHost");

const fixtureTools: Tool[] = [
  {
    name: "set_temperature",
    description: "controls the heat",
    input_schema: {
      type: "object",
      properties: {
        temperature: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
        bias: { type: "number" },
      },
    },
  },
  {
    name: "set_mode",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["fast", "slow", "auto"], default: "auto" },
      },
    },
  },
  {
    name: "toggle_debug",
    input_schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "name_it",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string" },
        count: { type: "integer", default: 1 },
        shape: { type: "object", properties: { x: { type: "number" } } },
      },
    },
  },
];

function buildFixtureHtml(tools: unknown, params?: unknown): string {
  const capTag =
    tools === undefined
      ? ""
      : `<script id="wb-capabilities" type="application/x-workbook-capabilities" data-version="1">${JSON.stringify(tools)}<\/script>`;
  const paramsTag =
    params === undefined
      ? ""
      : `<script id="wb-params" type="application/x-workbook-params" data-version="1">${JSON.stringify(params)}<\/script>`;
  return `<!doctype html><html><head>${capTag}${paramsTag}</head><body></body></html>`;
}

class MinimalElement {
  textContent: string | null;
  constructor(text: string) { this.textContent = text; }
}

class MinimalDocument {
  private capText: string | null;
  private paramsText: string | null;
  constructor(capText: string | null, paramsText: string | null = null) {
    this.capText = capText;
    this.paramsText = paramsText;
  }
  querySelector(sel: string): MinimalElement | null {
    if (sel === "script#wb-capabilities") {
      return this.capText === null ? null : new MinimalElement(this.capText);
    }
    if (sel === "script#wb-params") {
      return this.paramsText === null ? null : new MinimalElement(this.paramsText);
    }
    return null;
  }
}

function extractTagBody(html: string, marker: string): string | null {
  const open = html.indexOf(marker);
  if (open < 0) return null;
  const tagEnd = html.indexOf(">", open);
  const close = html.indexOf("</" + "script>", tagEnd);
  return html.slice(tagEnd + 1, close);
}

class MinimalDOMParser {
  parseFromString(html: string, _type: string) {
    const cap = extractTagBody(html, '<script id="wb-capabilities"');
    const params = extractTagBody(html, '<script id="wb-params"');
    return new MinimalDocument(cap, params) as unknown as Document;
  }
}

function testDispatchTable() {
  assert.equal(dispatchControl({ type: "number", minimum: 0, maximum: 1 }), "slider");
  assert.equal(dispatchControl({ type: "number" }), "number");
  assert.equal(dispatchControl({ type: "integer" }), "integer");
  assert.equal(dispatchControl({ type: "string", enum: ["a", "b"] }), "select");
  assert.equal(dispatchControl({ type: "string" }), "text");
  assert.equal(dispatchControl({ type: "boolean" }), "boolean");
  assert.equal(dispatchControl({ type: "object" }), "complex");
  assert.equal(dispatchControl({ type: "array" }), "complex");
  console.log("ok dispatch table covers number+range, number, integer, enum, string, boolean, complex");
}

function testGroupBuilding() {
  const groups = groupsFromTools(fixtureTools);
  assert.equal(groups.length, 4, "all four tools produce groups");

  const temp = groups[0];
  assert.equal(temp.name, "set_temperature");
  assert.equal(temp.controls.length, 2);
  assert.equal(temp.controls[0].kind, "slider");
  assert.equal(temp.controls[1].kind, "number");

  const mode = groups[1];
  assert.equal(mode.controls[0].kind, "select");
  assert.deepEqual(mode.controls[0].schema.enum, ["fast", "slow", "auto"]);

  const dbg = groups[2];
  assert.equal(dbg.controls[0].kind, "boolean");

  const mixed = groups[3];
  const kinds = mixed.controls.map((c) => c.kind);
  assert.deepEqual(kinds, ["text", "integer", "complex"]);
  console.log("ok groups + controls render expected dispatch for fixture");
}

function testParseCapabilitiesFromHtml() {
  const html = buildFixtureHtml(fixtureTools);
  const parser = new MinimalDOMParser();
  const tools = parseCapabilitiesFromHtml(html, parser);
  assert.ok(tools, "tools parsed");
  assert.equal(tools!.length, 4);
  assert.equal(tools![0].name, "set_temperature");
  console.log("ok parse <script id='wb-capabilities'> JSON");
}

function testParseMissingCapabilities() {
  const html = "<!doctype html><html><body>nothing here</body></html>";
  const parser = new MinimalDOMParser();
  const tools = parseCapabilitiesFromHtml(html, parser);
  assert.equal(tools, null, "missing tag returns null");
  console.log("ok missing wb-capabilities → null → empty-state");
}

function testParseMalformed() {
  const html = '<!doctype html><html><head><script id="wb-capabilities">not json{}</script></head></html>';
  const parser = new MinimalDOMParser();
  const tools = parseCapabilitiesFromHtml(html, parser);
  assert.equal(tools, null, "malformed json returns null");
  console.log("ok malformed wb-capabilities → null");
}

function testYDocRoundTrip() {
  const doc = new Y.Doc();
  const stateMap = doc.getMap<unknown>("state");

  const groups = groupsFromTools(fixtureTools);
  const tempControl = groups[0].controls[0];

  const observed: Array<[string, unknown]> = [];
  stateMap.observe(() => {
    for (const [k, v] of stateMap.entries()) observed.push([k, v]);
  });

  doc.transact(() => stateMap.set(tempControl.key, 0.75));
  assert.equal(stateMap.get("temperature"), 0.75, "doc write persists");
  assert.ok(
    observed.some(([k, v]) => k === "temperature" && v === 0.75),
    "observer fires on write — used by component to rehydrate control state",
  );

  stateMap.set("temperature", 0.25);
  assert.equal(stateMap.get("temperature"), 0.25, "external write reflected — control would rehydrate");
  console.log("ok Y.doc round-trip: control write → map.set, external set → observer fires");
}

const fixtureParams = {
  hue: { type: "number", minimum: 0, maximum: 360, default: 180 },
  mode: { type: "string", enum: ["a", "b"], default: "a" },
  count: { type: "integer", default: 3 },
  flag: { type: "boolean", default: false },
};

function testGroupFromParams() {
  const group = groupFromParams(fixtureParams);
  assert.ok(group, "group built");
  assert.equal(group!.name, "Params");
  assert.equal(group!.controls.length, 4);
  const byKey = Object.fromEntries(group!.controls.map((c) => [c.key, c]));
  assert.equal(byKey["params.hue"].kind, "slider", "min+max number → slider");
  assert.equal(byKey["params.hue"].label, "hue", "label is the unprefixed name");
  assert.equal(byKey["params.mode"].kind, "select");
  assert.equal(byKey["params.count"].kind, "integer");
  assert.equal(byKey["params.flag"].kind, "boolean");
  console.log("ok groupFromParams → namespaced 'params.<name>' keys, correct dispatch");
}

function testGroupFromParamsEmpty() {
  assert.equal(groupFromParams({}), null, "empty params → null");
  console.log("ok empty params → null (caller suppresses empty group)");
}

function testParseParamsFromHtml() {
  const html = buildFixtureHtml(fixtureTools, fixtureParams);
  const parser = new MinimalDOMParser();
  const params = parseParamsFromHtml(html, parser);
  assert.ok(params, "params parsed");
  assert.equal(Object.keys(params!).length, 4);
  assert.equal((params!.hue as { minimum: number }).minimum, 0);
  console.log("ok parse <script id='wb-params'> JSON object");
}

function testParseParamsMissing() {
  const html = buildFixtureHtml(fixtureTools);
  const parser = new MinimalDOMParser();
  assert.equal(parseParamsFromHtml(html, parser), null);
  console.log("ok missing wb-params → null");
}

function testParseParamsRejectsArray() {
  const html = `<!doctype html><html><head><script id="wb-params">[1,2]</script></head></html>`;
  const parser = new MinimalDOMParser();
  assert.equal(parseParamsFromHtml(html, parser), null);
  console.log("ok array-shaped wb-params payload → null");
}

function testParamsOnlyFixture() {
  // A workbook with only params (no tools) still produces a panel
  const html = buildFixtureHtml(undefined, fixtureParams);
  const parser = new MinimalDOMParser();
  const tools = parseCapabilitiesFromHtml(html, parser);
  const params = parseParamsFromHtml(html, parser);
  assert.equal(tools, null, "no tools tag");
  assert.ok(params, "params present");
  const group = groupFromParams(params!);
  assert.ok(group);
  assert.equal(group!.controls.length, 4);
  console.log("ok params-only workbook still produces a panel");
}

function testCombinedToolsAndParams() {
  const html = buildFixtureHtml(fixtureTools, fixtureParams);
  const parser = new MinimalDOMParser();
  const tools = parseCapabilitiesFromHtml(html, parser);
  const params = parseParamsFromHtml(html, parser);
  assert.ok(tools);
  assert.ok(params);
  const merged = [...groupsFromTools(tools!)];
  const paramGroup = groupFromParams(params!);
  if (paramGroup) merged.push(paramGroup);
  assert.equal(merged.length, 5, "4 tool groups + 1 params group");
  assert.equal(merged[merged.length - 1].name, "Params", "params group rendered last");
  // Verify Y.doc key namespacing prevents collision: a tool may declare
  // a `mode` property AND params may declare a `mode` param — keys differ.
  const toolKeys = merged.slice(0, 4).flatMap((g) => g.controls.map((c) => c.key));
  const paramKeys = paramGroup!.controls.map((c) => c.key);
  for (const pk of paramKeys) {
    assert.ok(pk.startsWith("params."), `param key '${pk}' is namespaced`);
    assert.ok(!toolKeys.includes(pk), `param key '${pk}' doesn't collide with tool keys`);
  }
  console.log("ok combined render: tool groups + params group, namespaced keys avoid collision");
}

testDispatchTable();
testGroupBuilding();
testParseCapabilitiesFromHtml();
testParseMissingCapabilities();
testParseMalformed();
testYDocRoundTrip();
testGroupFromParams();
testGroupFromParamsEmpty();
testParseParamsFromHtml();
testParseParamsMissing();
testParseParamsRejectsArray();
testParamsOnlyFixture();
testCombinedToolsAndParams();

console.log("\nall effects-panel tests passed");
