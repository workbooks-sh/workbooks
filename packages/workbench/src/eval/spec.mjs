// Eval spec loader. Supports two on-disk forms:
//   - <name>.eval.json  — pure JSON, parsed with JSON.parse
//   - <name>.eval.md    — YAML frontmatter + markdown body (notes ignored)
// Both normalize to the same internal shape.

import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export async function loadSpec(filePath) {
  const abs = path.resolve(filePath);
  const raw = await fs.readFile(abs, "utf8");
  let parsed;
  if (abs.endsWith(".eval.json")) {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`eval: ${abs}: invalid JSON (${err.message})`);
    }
  } else if (abs.endsWith(".eval.md")) {
    parsed = parseFrontmatter(raw, abs);
  } else {
    throw new Error(`eval: unsupported extension for ${path.basename(abs)} (use .eval.json or .eval.md)`);
  }
  return normalizeSpec(parsed, abs);
}

export async function discoverSpecs(rootDir) {
  const out = [];
  await walk(rootDir, out);
  out.sort();
  return out;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile() && (e.name.endsWith(".eval.json") || e.name.endsWith(".eval.md"))) {
      out.push(full);
    }
  }
}

function parseFrontmatter(raw, sourcePath) {
  // Frontmatter delimiter is `---` on its own line at top of file,
  // closed by another `---` on its own line. Everything between
  // is YAML; everything after is markdown body and ignored.
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error(`eval: ${sourcePath}: .eval.md must start with "---" frontmatter`);
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") { closeIdx = i; break; }
  }
  if (closeIdx === -1) {
    throw new Error(`eval: ${sourcePath}: unterminated frontmatter (no closing "---")`);
  }
  const yamlSrc = lines.slice(1, closeIdx).join("\n");
  try {
    return parseYaml(yamlSrc);
  } catch (err) {
    throw new Error(`eval: ${sourcePath}: invalid YAML frontmatter (${err.message})`);
  }
}

function normalizeSpec(spec, sourcePath) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`eval: ${sourcePath}: top-level must be an object`);
  }
  const name = spec.name ?? path.basename(sourcePath, ".eval.json");

  // wb-ojss.4 P1 — multi-session specs declare a `sessions:` array;
  // single-session specs continue to use top-level `agent`. When
  // sessions: is present, top-level `agent` is optional (each session
  // names its own agent).
  const sessionsDecl = parseSessions(spec, sourcePath);
  const hasMultiSessions = sessionsDecl !== null;

  const agent = spec.agent;
  if (!hasMultiSessions && (!agent || typeof agent !== "string")) {
    throw new Error(`eval: ${sourcePath}: "agent" is required (string) when "sessions" is not declared`);
  }

  const turns = Array.isArray(spec.turns) ? spec.turns : [];
  if (turns.length === 0) {
    throw new Error(`eval: ${sourcePath}: "turns" must be a non-empty array`);
  }
  const normalizedTurns = turns.map((t, i) => {
    if (!t || typeof t !== "object") {
      throw new Error(`eval: ${sourcePath}: turn ${i} must be an object`);
    }
    if (t.prompt !== undefined && t.prompt !== null && typeof t.prompt !== "string") {
      throw new Error(`eval: ${sourcePath}: turn ${i} "prompt" must be a string when set`);
    }
    if (t.action !== undefined && t.action !== null) {
      if (typeof t.action !== "object" || Array.isArray(t.action) || typeof t.action.kind !== "string") {
        throw new Error(`eval: ${sourcePath}: turn ${i} "action" must be an object with a "kind" string`);
      }
    }
    const checks = Array.isArray(t.checks) ? t.checks : [];
    if (!t.prompt && !t.action && checks.length === 0) {
      throw new Error(`eval: ${sourcePath}: turn ${i} must have a prompt, an action, or at least one check`);
    }
    const idleBeforeMs = typeof t.idleBeforeMs === "number" ? t.idleBeforeMs : 0;

    // wb-ojss.4 P1 — per-turn session id and cross-session ordering.
    // Single-session specs leave `session` unset; runner defaults to
    // "default". Multi-session specs MUST name a declared session.
    let session = null;
    if (t.session !== undefined && t.session !== null) {
      if (typeof t.session !== "string") {
        throw new Error(`eval: ${sourcePath}: turn ${i} "session" must be a string`);
      }
      session = t.session;
    }
    if (hasMultiSessions) {
      if (!session) {
        throw new Error(`eval: ${sourcePath}: turn ${i} must declare "session" when "sessions" is set`);
      }
      const known = sessionsDecl.some((s) => s.id === session);
      if (!known) {
        throw new Error(`eval: ${sourcePath}: turn ${i} references unknown session "${session}"`);
      }
    }

    let after = null;
    if (t.after !== undefined && t.after !== null) {
      if (typeof t.after !== "string") {
        throw new Error(`eval: ${sourcePath}: turn ${i} "after" must be a string of form "<sessionId>.turn.<n>"`);
      }
      const m = /^([A-Za-z0-9_-]+)\.turn\.(\d+)$/.exec(t.after);
      if (!m) {
        throw new Error(`eval: ${sourcePath}: turn ${i} "after" must match /^<sessionId>\\.turn\\.<n>$/, got ${JSON.stringify(t.after)}`);
      }
      after = { sessionId: m[1], turnIdx: Number(m[2]) };
      if (hasMultiSessions && !sessionsDecl.some((s) => s.id === after.sessionId)) {
        throw new Error(`eval: ${sourcePath}: turn ${i} "after" references unknown session "${after.sessionId}"`);
      }
    }

    return { prompt: t.prompt ?? null, action: t.action ?? null, checks, idleBeforeMs, session, after };
  });
  const setup = Array.isArray(spec.setup) ? spec.setup : [];
  const cleanup = Array.isArray(spec.cleanup) ? spec.cleanup : [];
  const orgId =
    typeof spec.orgId === "string" && spec.orgId.length > 0 ? spec.orgId : null;
  return {
    sourcePath,
    name,
    // For multi-session specs, this is the fallback agent; per-session
    // agent is the source of truth.
    agent: agent ?? null,
    sessions: sessionsDecl,
    resume: Boolean(spec.resume),
    timeoutMs: typeof spec.timeoutMs === "number" ? spec.timeoutMs : 10 * 60 * 1000,
    runtime: typeof spec.runtime === "string" ? spec.runtime : null,
    // wb-r62g — pin the session to a specific org the user belongs to
    // (slug or `personal:<sub>`). Defaults to the user's session-default
    // org; eval framework sets this so test artifacts land in a
    // disposable substrate rather than the user's main workspace.
    orgId,
    setup,
    turns: normalizedTurns,
    cleanup,
  };
}

// Returns either an array of {id, agent, runtime?} entries or null when
// the spec is single-session. Validates non-empty + unique ids.
function parseSessions(spec, sourcePath) {
  if (spec.sessions === undefined || spec.sessions === null) return null;
  if (!Array.isArray(spec.sessions) || spec.sessions.length === 0) {
    throw new Error(`eval: ${sourcePath}: "sessions" must be a non-empty array when declared`);
  }
  const seen = new Set();
  const out = [];
  for (let i = 0; i < spec.sessions.length; i++) {
    const s = spec.sessions[i];
    if (!s || typeof s !== "object") {
      throw new Error(`eval: ${sourcePath}: session ${i} must be an object`);
    }
    if (typeof s.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(s.id)) {
      throw new Error(`eval: ${sourcePath}: session ${i} "id" must be a string matching /^[A-Za-z0-9_-]+$/`);
    }
    if (seen.has(s.id)) {
      throw new Error(`eval: ${sourcePath}: duplicate session id "${s.id}"`);
    }
    seen.add(s.id);
    const agent = typeof s.agent === "string" && s.agent.length > 0 ? s.agent : spec.agent;
    if (!agent) {
      throw new Error(`eval: ${sourcePath}: session "${s.id}" must declare "agent" (or set top-level "agent" as default)`);
    }
    const runtime = typeof s.runtime === "string" ? s.runtime : null;
    out.push({ id: s.id, agent, runtime });
  }
  return out;
}
