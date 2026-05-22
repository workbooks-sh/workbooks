import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const systemPrompt = fs.readFileSync(
  path.join(__dirname, "src/system-prompt.md"),
  "utf8",
);

export default {
  name: "UGC Pro script writer",
  slug: "ugc-pro-script-writer",
  entry: "index.html",
  type: "agent",
  description: "30s short-form video scripts for Kelly Rockline's UGC shop.",
  agent: {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    systemPrompt,
    tagline: "Turns a UGC concept into a 30s short-form video script.",
    icon: "✍",
    tools: ["bash", "read", "write", "edit", "render"],
    components: {
      stage: "./src/components/stage.js",
    },
    permissions: {
      write_folder: true,
      read_context: true,
    },
  },
};
