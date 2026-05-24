// `workbook connections` — list integration connections you can use.
//
//   workbook connections list
//
// Output: table of toolkit slugs and the scope they're granted under
// (your private, shared with N groups, or whole organization). Filter
// by toolkit with --toolkit <slug>. JSON output via --json.
//
// Use cases:
//   - "do I have GitHub set up here?"  → `workbook connections list --toolkit github`
//   - script lookup for which slugs to declare in workbook config
//   - sanity-check before publishing an agent that needs `oauth:gmail`
//
// Sharing edits (private / groups / org) live in Studio →
// /integrations. The CLI is read-only for now.

import {
  apiGet,
  ensureBearer,
  DEFAULT_BROKER,
} from "../util/brokerClient.mjs";

export async function runConnections(flags) {
  const action = flags._?.[0] ?? "list";
  if (action === "help" || action === "--help") return printUsage();

  const bearer = await ensureBearer({ force: flags["force-auth"] });
  const ctx = { bearer, broker: DEFAULT_BROKER };

  switch (action) {
    case "list":
      return list(flags, ctx);
    default:
      usage(`unknown subcommand '${action}'`);
  }
}

function statusBadge(scope, sharedGroupIds, isOwn) {
  if (scope === "org") return "team";
  if ((sharedGroupIds ?? []).length > 0) {
    const n = sharedGroupIds.length;
    return n === 1 ? "1 group" : `${n} groups`;
  }
  return isOwn ? "private" : "shared";
}

async function list(flags, ctx) {
  const r = await apiGet("/v1/connections", ctx);
  let conns = r.connections ?? [];
  if (flags.toolkit) {
    const t = String(flags.toolkit).toLowerCase();
    conns = conns.filter((c) => c.toolkitSlug.toLowerCase() === t);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(conns, null, 2) + "\n");
    return;
  }
  if (conns.length === 0) {
    process.stdout.write(
      flags.toolkit
        ? `No active ${flags.toolkit} connection.\n`
        : "No connections. Visit Studio → Integrations to connect one.\n",
    );
    return;
  }
  const maxSlug = Math.max(...conns.map((c) => c.toolkitSlug.length), 7);
  const maxName = Math.max(
    ...conns.map((c) => (c.toolkitName ?? "").length),
    4,
  );
  process.stdout.write(
    `${"TOOLKIT".padEnd(maxSlug)}  ${"NAME".padEnd(maxName)}  SCOPE     STATUS\n`,
  );
  for (const c of conns) {
    const badge = statusBadge(c.ownerScope, c.sharedGroupIds, c.isOwn);
    process.stdout.write(
      `${c.toolkitSlug.padEnd(maxSlug)}  ${(c.toolkitName ?? "").padEnd(maxName)}  ${badge.padEnd(8)}  ${c.status}\n`,
    );
  }
}

function usage(msg) {
  if (msg) process.stderr.write(`workbook connections: ${msg}\n`);
  printUsage();
  process.exit(1);
}

function printUsage() {
  process.stdout.write(
    [
      "workbook connections — list integration connections.",
      "",
      "Commands:",
      "  workbook connections list                    list everything you can use here",
      "    --toolkit <slug>                           filter to one toolkit (e.g. gmail)",
      "    --json                                     emit JSON for tooling",
      "",
      "Sharing edits live in Studio → Integrations.",
      "",
    ].join("\n"),
  );
}
