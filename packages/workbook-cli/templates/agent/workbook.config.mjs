// Agent workbook — defines a server-side LLM loop that runs in Studio.
// The artifact's HTML body is a renderable preview/catalog page; the
// canonical definition is the embedded `<script id="wb-agent">` JSON
// read by the workbooks-agent backend on publish.
//
// On `workbook publish --group <id>`, this builds → POSTs to
// /v1/agents (not /v1/workbooks) and lands in Studio's /chat agent
// picker. See README.md for the attach flow.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const systemPrompt = fs.readFileSync(
  path.join(__dirname, "src/system-prompt.md"),
  "utf8",
);

export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  entry: "index.html",
  type: "agent",
  agent: {
    // 'anthropic/claude-sonnet-4.6' is the canonical Anthropic id. The
    // broker resolves provider+model to the right upstream — openrouter
    // today, direct api.anthropic.com once the broker-proxy capability
    // is live.
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    systemPrompt,
    // pi-coding-agent tool allowlist. Strings of the form
    // "oauth:<toolkit>" bind every action of that broker-managed
    // OAuth toolkit at session start (requires an active Studio →
    // Integrations connection).
    tools: [],
    // Per-name JS files, each exporting (target, props, emit) => unmount.
    // The stage is what the agent writes its draft into.
    components: {
      stage: "./src/components/stage.js",
    },
    // tagline: "What this agent does in one phrase.",
    // icon: "./src/icon.svg",
    //
    // permissions: { write_folder: "drafts", context_folder: "inbox" },
    // declares the agent's read/write surface against a group's shared
    // folder tree. Uncomment + name folders once the group is created.
  },
  // author: "Your name",
  // description: "One-sentence description of what this agent does.",
};
