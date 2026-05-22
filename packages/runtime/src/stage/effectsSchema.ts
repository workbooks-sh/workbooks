/**
 * Pure helpers for the auto-generated effects panel. Kept in plain TS
 * (no Svelte) so the dispatch and parse logic can be unit-tested
 * without a DOM mount. EffectsPanel.svelte imports these directly.
 */

export interface JsonSchema {
  type?: string;
  minimum?: number;
  maximum?: number;
  enum?: Array<string | number>;
  default?: unknown;
  description?: string;
  properties?: Record<string, JsonSchema>;
}

export interface Tool {
  name?: string;
  description?: string;
  input_schema?: JsonSchema;
}

export type ControlKind = "slider" | "number" | "integer" | "select" | "text" | "boolean" | "complex";

export interface Control {
  key: string;
  label: string;
  kind: ControlKind;
  schema: JsonSchema;
  description?: string;
}

export interface ToolGroup {
  name: string;
  description?: string;
  controls: Control[];
}

export function dispatchControl(schema: JsonSchema): ControlKind {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "select";
  const t = schema.type;
  if (t === "number") {
    return typeof schema.minimum === "number" && typeof schema.maximum === "number" ? "slider" : "number";
  }
  if (t === "integer") return "integer";
  if (t === "boolean") return "boolean";
  if (t === "string") return "text";
  return "complex";
}

export function controlsFromTool(tool: Tool): Control[] {
  const props = tool.input_schema?.properties;
  if (!props || typeof props !== "object") return [];
  const out: Control[] = [];
  for (const [key, sub] of Object.entries(props)) {
    if (!sub || typeof sub !== "object") continue;
    out.push({
      key,
      label: key,
      kind: dispatchControl(sub),
      schema: sub,
      description: sub.description,
    });
  }
  return out;
}

export function groupsFromTools(tools: Tool[]): ToolGroup[] {
  const out: ToolGroup[] = [];
  for (const tool of tools) {
    const controls = controlsFromTool(tool);
    if (controls.length === 0) continue;
    out.push({
      name: tool.name ?? "(unnamed tool)",
      description: tool.description,
      controls,
    });
  }
  return out;
}

// Params come in as a flat map { name: JsonSchema }. Each entry IS a
// single-property input_schema — we reuse dispatchControl. Y.doc keys
// are namespaced "params.<name>" to prevent collision with tool keys,
// which stay flat (matching how the runtime already binds tool args).
export function groupFromParams(params: Record<string, JsonSchema>): ToolGroup | null {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;
  const controls: Control[] = [];
  for (const [name, sub] of entries) {
    if (!sub || typeof sub !== "object") continue;
    controls.push({
      key: `params.${name}`,
      label: name,
      kind: dispatchControl(sub),
      schema: sub,
      description: sub.description,
    });
  }
  if (controls.length === 0) return null;
  return { name: "Params", controls };
}

export function parseCapabilitiesFromHtml(
  html: string,
  parser: { parseFromString(s: string, t: string): Document },
): Tool[] | null {
  const docHtml = parser.parseFromString(html, "text/html");
  const script = docHtml.querySelector("script#wb-capabilities");
  if (!script) return null;
  const text = script.textContent?.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseParamsFromHtml(
  html: string,
  parser: { parseFromString(s: string, t: string): Document },
): Record<string, JsonSchema> | null {
  const docHtml = parser.parseFromString(html, "text/html");
  const script = docHtml.querySelector("script#wb-params");
  if (!script) return null;
  const text = script.textContent?.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, JsonSchema>;
  } catch {
    return null;
  }
}
