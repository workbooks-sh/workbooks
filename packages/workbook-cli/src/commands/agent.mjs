// `workbook agent <sub>` — agent-lifecycle subcommands.
//
//   workbook agent list [--json]
//     List agents in your org.
//
//   workbook agent show <slug|id> [--json] [--manifest-only]
//     Show one agent's manifest summary + recent sessions.
//
//   workbook agent pull <id> [--out <file.html>]
//     Download a published agent's HTML artifact (with embedded
//     wb-agent + wb-source-bundle) from the broker.
//
// publish remains on the top-level `workbook publish <html>` flow,
// which auto-routes to /v1/agents when the artifact's config has
// type:"agent".

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { ensureBearer } from "./publish.mjs";

const DEFAULT_BROKER = process.env.WORKBOOKS_BROKER ?? "https://auth.workbooks.sh";

export async function runAgent(flags = {}) {
  const sub = flags._?.[0];
  switch (sub) {
    case "list":
      return runList({ ...flags, _: flags._.slice(1) });
    case "show":
      return runShow({ ...flags, _: flags._.slice(1) });
    case "edit":
      return runEdit({ ...flags, _: flags._.slice(1) });
    case "create":
      return runCreate({ ...flags, _: flags._.slice(1) });
    case "pull":
      return runPull(flags);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage());
      return;
    default:
      process.stderr.write(`workbook agent: unknown subcommand '${sub}'\n${usage()}`);
      process.exit(2);
  }
}

function usage() {
  return [
    "workbook agent — agent lifecycle subcommands",
    "",
    "  workbook agent list [--json]",
    "    List agents in your org.",
    "",
    "  workbook agent show <slug|id> [--json] [--manifest-only]",
    "    Show one agent's manifest summary + recent sessions.",
    "",
    "  workbook agent edit <slug|id> [--editor <cmd>] [--resume]",
    "    Open the agent's title/tagline/manifest in $EDITOR, push back on save.",
    "",
    "  workbook agent create <slug> [--title <name>] [--model <id>] [--prompt <text|@file>]",
    "                       [--tools <a,b,c>] [--from basic|chat|scripted] [--json]",
    "    Create a new agent in your org from a minimal manifest.",
    "",
    "  workbook agent pull <id> [--out <file.html>]",
    "    Download a published agent artifact from the broker.",
    "",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────
// list
// ─────────────────────────────────────────────────────────────────

async function runList(flags) {
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const res = await fetch(`${DEFAULT_BROKER}/v1/agents`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(
      `workbook agent list: broker returned ${res.status}: ${text.slice(0, 300)}\n`,
    );
    process.exit(1);
  }
  const data = JSON.parse(text);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ kind: "agent.list", agents: data.agents }) + "\n");
    return;
  }
  const rows = Array.isArray(data.agents) ? data.agents : [];
  if (rows.length === 0) {
    process.stdout.write("(no agents in this org)\n");
    return;
  }
  const now = Date.now();
  const lines = rows.map((a) => {
    const slug = (a.slug ?? "?").padEnd(28).slice(0, 28);
    const title = (a.title ?? "").padEnd(36).slice(0, 36);
    const model = (a.manifest?.model ?? "").padEnd(36).slice(0, 36);
    const toolCount = Array.isArray(a.manifest?.tools) ? a.manifest.tools.length : 0;
    const age = humanAge(now - (a.updated_at ?? 0) * 1000);
    return `${slug}  ${title}  ${model}  ${String(toolCount).padStart(2)} tools  ${age.padStart(6)}`;
  });
  process.stdout.write(lines.join("\n") + "\n");
}

// ─────────────────────────────────────────────────────────────────
// show
// ─────────────────────────────────────────────────────────────────

async function runShow(flags) {
  const target = flags._?.[0];
  if (!target) {
    process.stderr.write(
      "workbook agent show: missing <slug|id>\n  workbook agent show <slug|id> [--json] [--manifest-only]\n",
    );
    process.exit(2);
  }
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const agentRes = await fetch(
    `${DEFAULT_BROKER}/v1/agents/${encodeURIComponent(target)}`,
    { headers: { authorization: `Bearer ${bearer}` } },
  );
  const agentText = await agentRes.text();
  if (!agentRes.ok) {
    process.stderr.write(
      `workbook agent show: broker returned ${agentRes.status}: ${agentText.slice(0, 300)}\n`,
    );
    process.exit(1);
  }
  const agent = JSON.parse(agentText);

  if (flags["manifest-only"]) {
    const out = flags.json
      ? JSON.stringify({ kind: "agent.manifest", agent }) + "\n"
      : JSON.stringify(agent.manifest, null, 2) + "\n";
    process.stdout.write(out);
    return;
  }

  // Recent sessions (best-effort — never blocks the show).
  let sessions = [];
  try {
    const u = new URL(`${DEFAULT_BROKER}/v1/agents/sessions`);
    u.searchParams.set("limit", "5");
    if (agent.slug) u.searchParams.set("agentSlug", agent.slug);
    const sessRes = await fetch(u.toString(), {
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (sessRes.ok) {
      const j = await sessRes.json();
      sessions = Array.isArray(j.sessions) ? j.sessions : [];
    }
  } catch {
    /* swallow — show still renders without recent sessions */
  }

  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ kind: "agent.show", agent, recentSessions: sessions }) + "\n",
    );
    return;
  }

  const m = agent.manifest ?? {};
  const lines = [];
  lines.push(`${agent.slug ?? "?"}`);
  if (agent.title) lines.push(`  title:        ${agent.title}`);
  if (agent.tagline) lines.push(`  tagline:      ${agent.tagline}`);
  if (m.model) lines.push(`  model:        ${m.model}`);
  if (m.provider) lines.push(`  provider:     ${m.provider}`);
  if (Array.isArray(m.tools)) {
    lines.push(`  tools (${m.tools.length}):    ${m.tools.join(", ")}`);
  }
  if (Array.isArray(m.skills) && m.skills.length > 0) {
    lines.push(`  skills (${m.skills.length}):   ${m.skills.join(", ")}`);
  }
  if (Array.isArray(m.components) && m.components.length > 0) {
    lines.push(`  components:   ${m.components.join(", ")}`);
  }
  if (agent.version) lines.push(`  version:      ${agent.version}`);
  if (agent.updated_at) {
    const age = humanAge(Date.now() - agent.updated_at * 1000);
    lines.push(`  updated:      ${age} ago`);
  }

  if (sessions.length > 0) {
    lines.push("");
    lines.push(`Recent sessions:`);
    for (const s of sessions) {
      const id = String(s.id).slice(0, 16);
      const status = (s.status ?? "?").padEnd(9).slice(0, 9);
      const age = humanAge(Date.now() - (s.updatedAt ?? s.startedAt ?? Date.now()));
      const prompt = (s.firstPrompt ?? "").replace(/\s+/g, " ").slice(0, 60);
      lines.push(`  ${id}  ${status}  ${age.padStart(6)}  ${prompt}`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}

// ─────────────────────────────────────────────────────────────────
// edit — open the agent's title/tagline/manifest in $EDITOR
// ─────────────────────────────────────────────────────────────────

async function runEdit(flags) {
  const target = flags._?.[0];
  if (!target) {
    process.stderr.write(
      "workbook agent edit: missing <slug|id>\n  workbook agent edit <slug|id> [--editor <cmd>] [--resume]\n",
    );
    process.exit(2);
  }
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });

  // Fetch current state (by slug or id).
  const showRes = await fetch(
    `${DEFAULT_BROKER}/v1/agents/${encodeURIComponent(target)}`,
    { headers: { authorization: `Bearer ${bearer}` } },
  );
  const showText = await showRes.text();
  if (!showRes.ok) {
    process.stderr.write(
      `workbook agent edit: broker returned ${showRes.status}: ${showText.slice(0, 300)}\n`,
    );
    process.exit(1);
  }
  const agent = JSON.parse(showText);
  if (!agent.id) {
    process.stderr.write(
      "workbook agent edit: broker response missing id; cannot patch.\n",
    );
    process.exit(1);
  }

  // The editable view. Keep it minimal and well-shaped so the user
  // doesn't accidentally mangle metadata fields that aren't theirs
  // to change (id, slug, version, author_sub, timestamps).
  const draft = {
    title: agent.title ?? "",
    tagline: agent.tagline ?? "",
    manifest: agent.manifest ?? {},
  };

  // Cache file keyed by agent id so `--resume` reopens the same buffer
  // after a broker reject. Lives in the workbooks config dir alongside
  // auth.json so it's user-scoped and cleaned up by hand if needed.
  const cacheDir = path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "workbooks",
    "agent-edits",
  );
  await fs.mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${agent.id}.json`);

  let initialText;
  if (flags.resume) {
    try {
      initialText = await fs.readFile(cachePath, "utf8");
      process.stderr.write(`(resuming previous edit: ${cachePath})\n`);
    } catch {
      initialText = JSON.stringify(draft, null, 2) + "\n";
    }
  } else {
    initialText = JSON.stringify(draft, null, 2) + "\n";
  }

  await fs.writeFile(cachePath, initialText, { mode: 0o600 });

  const editor = flags.editor ?? process.env.VISUAL ?? process.env.EDITOR ?? "vi";
  const editorArgs = editor.split(/\s+/);
  const editorBin = editorArgs.shift();
  const code = await new Promise((resolve) => {
    const child = spawn(editorBin, [...editorArgs, cachePath], { stdio: "inherit" });
    child.on("exit", (c) => resolve(c ?? 0));
    child.on("error", (err) => {
      process.stderr.write(`workbook agent edit: editor failed: ${err.message}\n`);
      resolve(127);
    });
  });
  if (code !== 0) {
    process.stderr.write(
      `workbook agent edit: editor exited ${code}; draft kept at ${cachePath}\n`,
    );
    process.exit(code);
  }

  const newText = await fs.readFile(cachePath, "utf8");
  const beforeHash = createHash("sha256").update(initialText).digest("hex");
  const afterHash = createHash("sha256").update(newText).digest("hex");
  if (beforeHash === afterHash) {
    process.stdout.write("(no changes — nothing to push)\n");
    await fs.unlink(cachePath).catch(() => undefined);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(newText);
  } catch (err) {
    process.stderr.write(
      `workbook agent edit: invalid JSON — ${err.message}\n` +
        `  draft preserved at ${cachePath}\n` +
        `  fix and re-run: workbook agent edit ${target} --resume\n`,
    );
    process.exit(2);
  }
  if (!parsed || typeof parsed !== "object") {
    process.stderr.write(
      "workbook agent edit: top-level must be an object with { title, tagline, manifest }\n",
    );
    process.exit(2);
  }
  const patchBody = {};
  if (parsed.title !== undefined) patchBody.title = parsed.title;
  if (parsed.tagline !== undefined) patchBody.tagline = parsed.tagline;
  if (parsed.manifest !== undefined) patchBody.manifestPatch = parsed.manifest;

  const patchRes = await fetch(
    `${DEFAULT_BROKER}/v1/agents/${encodeURIComponent(agent.id)}/manifest`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(patchBody),
    },
  );
  const patchText = await patchRes.text();
  if (!patchRes.ok) {
    process.stderr.write(
      `workbook agent edit: broker rejected ${patchRes.status}: ${patchText.slice(0, 500)}\n` +
        `  draft preserved at ${cachePath}\n` +
        `  fix and re-run: workbook agent edit ${target} --resume\n`,
    );
    process.exit(1);
  }

  await fs.unlink(cachePath).catch(() => undefined);
  process.stdout.write(`✓ updated ${agent.slug ?? agent.id}\n`);
}

// ─────────────────────────────────────────────────────────────────
// create — scaffold a new agent in the org
// ─────────────────────────────────────────────────────────────────

const AGENT_TEMPLATES = {
  basic: {
    title: "New agent",
    tools: ["bash", "read", "write", "edit"],
    systemPrompt:
      "You are a new agent. Your task is whatever the user asks. Use bash/read/write/edit to operate on files in /home/user/work as needed.",
  },
  chat: {
    title: "Chat agent",
    tools: ["render"],
    systemPrompt:
      "You are a conversational agent. Reply in plain text. Use `render` with a structured block when showing tabular or numeric data.",
  },
  scripted: {
    title: "Scripting agent",
    tools: ["bash", "read", "write", "edit", "web_search"],
    systemPrompt:
      "You are a senior shell scripter. When asked to do a task, write a clear plan, then execute it via bash. Always show the user what you ran and what it returned.",
  },
};

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_PROVIDER = "openrouter";

async function runCreate(flags) {
  const slug = flags._?.[0];
  if (!slug) {
    process.stderr.write(
      "workbook agent create: missing <slug>\n  workbook agent create <slug> [--title <name>] [--model <id>] [--prompt <text|@file>] [--tools <a,b,c>] [--template basic|chat|scripted]\n",
    );
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    process.stderr.write(
      `workbook agent create: bad slug '${slug}' — must be lowercase alphanumeric + dashes, ≤63 chars\n`,
    );
    process.exit(2);
  }

  /* `--template` is reserved at the top-level CLI parser for the
   * publish-time redistributable flag, so we accept `--from` here
   * (and also tolerate `--preset` as an alias). */
  const tplName = flags.from ?? flags.preset ?? "basic";
  const tpl = AGENT_TEMPLATES[tplName];
  if (!tpl) {
    process.stderr.write(
      `workbook agent create: unknown --from '${tplName}' (available: ${Object.keys(AGENT_TEMPLATES).join(", ")})\n`,
    );
    process.exit(2);
  }

  let systemPrompt = tpl.systemPrompt;
  if (typeof flags.prompt === "string" && flags.prompt.length > 0) {
    if (flags.prompt.startsWith("@")) {
      const filePath = flags.prompt.slice(1);
      try {
        systemPrompt = await fs.readFile(filePath, "utf8");
      } catch (err) {
        process.stderr.write(
          `workbook agent create: failed to read prompt file '${filePath}': ${err.message}\n`,
        );
        process.exit(2);
      }
    } else {
      systemPrompt = flags.prompt;
    }
  }

  const tools = typeof flags.tools === "string" && flags.tools.length > 0
    ? flags.tools.split(",").map((t) => t.trim()).filter(Boolean)
    : tpl.tools;

  const manifest = {
    version: 1,
    provider: DEFAULT_PROVIDER,
    model: flags.model ?? DEFAULT_MODEL,
    systemPrompt,
    tools,
    extensions: [],
  };

  const body = {
    slug,
    title: flags.title ?? tpl.title,
    tagline: flags.tagline ?? null,
    description: flags.description ?? null,
    manifest,
  };

  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const res = await fetch(`${DEFAULT_BROKER}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(
      `workbook agent create: broker returned ${res.status}: ${text.slice(0, 400)}\n`,
    );
    process.exit(1);
  }
  const result = JSON.parse(text);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ kind: "agent.create", ...result }) + "\n");
    return;
  }
  const verb = result.created ? "created" : "updated";
  process.stdout.write(`✓ ${verb} ${result.slug ?? slug}\n  id: ${result.id}\n`);
  process.stdout.write(
    `  next: workbook agent edit ${result.slug ?? slug}\n` +
      `        workbook chat ${result.slug ?? slug} "hello"\n`,
  );
}

function humanAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

async function runPull(flags) {
  const id = flags._?.[1];
  if (!id) {
    process.stderr.write("workbook agent pull: missing <id>\n");
    process.exit(2);
  }
  const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
  const url = `${DEFAULT_BROKER}/v1/agents/${encodeURIComponent(id)}/artifact`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
  if (!res.ok) {
    process.stderr.write(`workbook agent pull: broker returned ${res.status}\n`);
    process.exit(1);
  }
  const html = Buffer.from(await res.arrayBuffer());
  const out = flags.out ?? `${id}.html`;
  await fs.writeFile(path.resolve(out), html);
  process.stdout.write(`pulled ${html.byteLength} bytes → ${out}\n`);
}
