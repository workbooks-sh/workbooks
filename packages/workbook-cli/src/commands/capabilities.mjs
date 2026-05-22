// `workbook capabilities` — Studio capability resolver (Phase 1, wb-yufs.4).
//
//   workbook capabilities catalog [--family <f>] [--json]
//   workbook capabilities resolve --group <gid> [--config <path>] [--json]
//   workbook capabilities explain <slug> [--json]
//
// Read-only surface for discovering, declaring, and previewing
// resolution of capabilities (LLM keys, OAuth toolkits, env-var
// secrets, databases, custom HTTP). Build-time embedding + runtime
// dispatch land in Phase 2.
//
// Spec: packages/workbooks/docs/CAPABILITY_RESOLVER.md.

import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import {
  apiGet,
  apiPost,
  ensureBearer,
  DEFAULT_BROKER,
} from "../util/brokerClient.mjs";

export async function runCapabilities(flags) {
  const action = flags._?.[0];
  if (!action || action === "help" || action === "--help") return printUsage();

  const bearer = await ensureBearer({ force: flags["force-auth"] });
  const ctx = { bearer, broker: DEFAULT_BROKER };

  switch (action) {
    case "catalog": return catalog(flags, ctx);
    case "resolve": return resolve(flags, ctx);
    case "explain": return explain(flags, ctx);
    default: usage(`unknown subcommand '${action}'`);
  }
}

async function catalog(flags, ctx) {
  const qs = flags.family ? `?family=${encodeURIComponent(flags.family)}` : "";
  const r = await apiGet(`/v1/capabilities/catalog${qs}`, ctx);
  const rows = r.capabilities ?? [];
  if (flags.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }
  if (rows.length === 0) {
    process.stdout.write(
      flags.family
        ? `No capabilities in family '${flags.family}'.\n`
        : "Catalog is empty.\n",
    );
    return;
  }
  const cols = [
    { key: "slug", header: "SLUG" },
    { key: "family", header: "FAMILY" },
    { key: "name", header: "NAME" },
    { key: "scopes", header: "SCOPES", get: (r) => (r.scopes_available ?? []).join(",") },
    { key: "docs", header: "DOCS", get: (r) => r.docs_url ?? "" },
  ];
  printTable(rows, cols);
}

async function resolve(flags, ctx) {
  const groupId = flags.group ?? flags.g;
  if (!groupId) usage("--group <id> is required");

  const configPath = flags.config ?? "./workbook.config.mjs";
  const cfg = await loadCapabilitiesBlock(configPath);
  if (!cfg || Object.keys(cfg).length === 0) {
    process.stdout.write(
      "No capabilities declared in workbook.config.mjs.\n" +
      "Add a `capabilities: { ... }` block — see " +
      "packages/workbooks/docs/CAPABILITY_RESOLVER.md.\n",
    );
    return;
  }

  const envelope = await apiPost(
    "/v1/capabilities/resolve",
    { manifest_capabilities: cfg, group_id: groupId, for: "dev" },
    ctx,
  );
  if (flags.json) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    return;
  }

  const resolved = envelope.resolved ?? [];
  const unresolved = envelope.unresolved ?? [];

  process.stdout.write("RESOLVED\n");
  if (resolved.length === 0) {
    process.stdout.write("  (none)\n");
  } else {
    printTable(
      resolved,
      [
        { key: "slug", header: "SLUG" },
        { key: "scope", header: "SCOPE", get: (r) => cfg[r.slug]?.scope ?? "" },
        { key: "actual_scope", header: "ACTUAL", get: (r) => r.actual_scope ?? r.scope ?? "" },
        { key: "endpoint_hint", header: "ENDPOINT", get: (r) => r.endpoint_hint ?? "" },
        { key: "ref", header: "REF-PREFIX", get: (r) => refPrefix(r.ref) },
      ],
      { indent: 2 },
    );
  }

  process.stdout.write("\nUNRESOLVED\n");
  if (unresolved.length === 0) {
    process.stdout.write("  (none)\n");
  } else {
    printTable(
      unresolved,
      [
        { key: "slug", header: "SLUG" },
        { key: "scope", header: "SCOPE", get: (r) => cfg[r.slug]?.scope ?? r.scope ?? "" },
        { key: "reason", header: "REASON", get: (r) => r.reason ?? "" },
        { key: "wire_url", header: "WIRE_URL", get: (r) => r.wire_url ?? "" },
      ],
      { indent: 2 },
    );
  }
}

async function explain(flags, ctx) {
  const slug = flags._?.[1];
  if (!slug) usage("workbook capabilities explain <slug>");

  const r = await apiGet("/v1/capabilities/catalog", ctx);
  const rows = r.capabilities ?? [];
  const entry = findCatalogEntry(rows, slug);
  if (!entry) {
    process.stderr.write(
      `no catalog entry for '${slug}'. Run \`workbook capabilities catalog\` to list available capabilities.\n`,
    );
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
    return;
  }

  const out = [];
  out.push(`${entry.slug}  —  ${entry.name ?? ""}`);
  out.push(`  family:       ${entry.family ?? ""}`);
  if (entry.description) out.push(`  description:  ${entry.description}`);
  if (entry.endpoint) out.push(`  endpoint:     ${entry.endpoint}`);
  out.push(`  scopes:       ${(entry.scopes_available ?? []).join(", ")}`);
  if (entry.auth?.scheme) out.push(`  auth:         ${entry.auth.scheme}`);
  if (entry.docs_url) out.push(`  docs:         ${entry.docs_url}`);
  if (entry.skill_slug) out.push(`  skill_slug:   ${entry.skill_slug}`);
  out.push("");
  out.push("Add this to workbook.config.mjs:");
  out.push("");
  out.push(snippet(slug, entry));
  out.push("");
  process.stdout.write(out.join("\n"));
}

function refPrefix(ref) {
  if (typeof ref !== "string") return "";
  const head = ref.split("/").slice(0, 5).join("/");
  return head.length < ref.length ? `${head}/…` : head;
}

function findCatalogEntry(rows, slug) {
  const exact = rows.find((r) => r.slug === slug);
  if (exact) return exact;
  const family = slug.split(":")[0];
  if (family === "env" || family === "db") {
    return rows.find((r) => r.slug === `${family}:*` || r.family === family) ?? null;
  }
  return null;
}

function snippet(slug, entry) {
  const family = entry.family ?? slug.split(":")[0];
  const lines = ["  capabilities: {"];
  if (family === "env") {
    lines.push(`    "${slug}": {`);
    lines.push(`      scope: "group",`);
    lines.push(`      inject: "header:X-Your-Header",`);
    lines.push(`      domains: ["api.example.com"],`);
    lines.push(`    },`);
  } else if (family === "db") {
    lines.push(`    "${slug}": {`);
    lines.push(`      scope: "group",`);
    lines.push(`      inject: "bearer",`);
    lines.push(`      domains: ["db.example.com"],`);
    lines.push(`    },`);
  } else {
    lines.push(`    "${slug}": { scope: "group" /* | "user" | "org" */ },`);
  }
  lines.push("  },");
  return lines.join("\n");
}

async function loadCapabilitiesBlock(configPath) {
  const abs = path.resolve(process.cwd(), configPath);
  try { await fs.access(abs); } catch {
    throw new Error(`config not found: ${configPath} (resolved to ${abs})`);
  }
  const mod = await import(pathToFileURL(abs).href);
  const cfg = mod.default ?? mod;
  if (!cfg || typeof cfg !== "object") {
    throw new Error(`${configPath} did not export a config object`);
  }
  return cfg.capabilities ?? null;
}

function printTable(rows, cols, { indent = 0 } = {}) {
  const pad = " ".repeat(indent);
  const widths = cols.map((c) => {
    const headerW = c.header.length;
    const cellW = Math.max(
      ...rows.map((r) => String(c.get ? c.get(r) : r[c.key] ?? "").length),
      0,
    );
    return Math.max(headerW, cellW);
  });
  const header = cols.map((c, i) => c.header.padEnd(widths[i])).join("  ");
  process.stdout.write(`${pad}${header}\n`);
  for (const r of rows) {
    const line = cols
      .map((c, i) => String(c.get ? c.get(r) : r[c.key] ?? "").padEnd(widths[i]))
      .join("  ");
    process.stdout.write(`${pad}${line}\n`);
  }
}

function usage(msg) {
  if (msg) process.stderr.write(`workbook capabilities: ${msg}\n\n`);
  printUsage();
  process.exit(2);
}

function printUsage() {
  process.stdout.write(
    [
      "workbook capabilities <subcommand>",
      "",
      "Subcommands:",
      "  catalog                          list capabilities Studio dispatches",
      "    --family <f>                   filter to one family (llm | oauth | env | db | …)",
      "    --json                         emit JSON for tooling",
      "  resolve --group <gid>            preview build/publish resolution against your config",
      "    --config <path>                path to workbook.config.mjs (default ./workbook.config.mjs)",
      "    --json                         emit the full envelope",
      "  explain <slug>                   show schema + dispatch + a copy-paste declaration",
      "    --json                         emit the catalog row",
      "",
      "Sharing edits live in Studio → Integrations. The CLI is read-only.",
      "",
    ].join("\n"),
  );
}
