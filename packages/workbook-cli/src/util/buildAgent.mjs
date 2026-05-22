// Build the JSON payload embedded in `<script id="wb-agent">` for
// workbooks declared with type: "agent". This is the canonical agent
// definition the workbooks-agent backend reads on publish to register
// the agent for chat sessions.
//
// Schema (data-version="1"):
// {
//   version: 1,
//   provider: string,             // e.g. "openrouter" | "anthropic" | ...
//   model: string,                // e.g. "anthropic/claude-sonnet-4.6"
//   systemPrompt: string,
//   tagline: string | null,
//   tools: string[],              // pi-coding-agent tool allowlist;
//                                 // entries of the form "composio:<toolkit>"
//                                 // bind every action of that toolkit as a
//                                 // callable tool at session start (caller
//                                 // must have an active connection in
//                                 // Studio → Integrations).
//   extensions: string[],         // optional npm/git package specs
//   runtimeTargets: string[],     // ordered compatible execution targets;
//                                 // browser-run / browser-opfs / linux-sandbox.
//   capabilities: string[],       // declared runtime requirements used by
//                                 // hosts to pick browser/edge/sandbox.
//   components: object | null,    // name → bundled JS factory; mounted
//                                 // by Studio's StagePane / chat UI.
//   skills: object | null,        // key → { description, docs } markdown refs.
//   schedules: Array<{...}>,      // optional schedule presets carried
//                                 // by the artifact; Studio stores
//                                 // executable schedules separately.
//   permissions: object | null,
//   defaultEnv: object | null,
// }
//
// The HTML body remains a renderable preview/catalog page — the
// embedded JSON has no runtime impact in the browser (non-script
// content-type means the browser never parses or evaluates it).

export const WB_AGENT_DATA_VERSION = "1";

export function buildAgentManifest(config) {
  if (config.type !== "agent" || !config.agent) {
    throw new Error("buildAgentManifest: config.type must be 'agent' with an agent block");
  }
  const a = config.agent;
  return {
    version: 1,
    provider: a.provider ?? "openrouter",
    model: a.model,
    systemPrompt: a.systemPrompt,
    tagline: a.tagline ?? null,
    icon: a.icon ?? null,
    tools: a.tools,
    extensions: a.extensions ?? [],
    runtimeTargets: a.runtimeTargets ?? ["linux-sandbox"],
    capabilities: a.capabilities ?? [],
    components: a.components ? Object.keys(a.components) : [],
    skills: a.skills ? Object.keys(a.skills) : [],
    schedules: a.schedules ?? [],
    permissions: a.permissions ?? null,
    defaultEnv: a.defaultEnv ?? null,
  };
}

export async function buildSkillsPayload(config) {
  const skills = config.agent?.skills;
  if (!skills || Object.keys(skills).length === 0) return null;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const out = {};
  for (const [key, { description, docs }] of Object.entries(skills)) {
    const docPath = path.resolve(config.root, docs);
    const body = await fs.readFile(docPath, "utf8");
    out[key] = { description, body };
  }
  return out;
}

export function buildAgentScriptTag(config, escapeForScript) {
  const manifest = buildAgentManifest(config);
  const json = escapeForScript(JSON.stringify(manifest));
  return (
    `<script id="wb-agent"` +
    ` type="application/x-workbook-agent"` +
    ` data-version="${WB_AGENT_DATA_VERSION}"` +
    `>${json}</script>`
  );
}
