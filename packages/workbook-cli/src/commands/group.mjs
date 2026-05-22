// `workbook group` — create groups, list them, invite teammates, manage tags.
//
//   workbook group create <name> [--slug <s>] [--description <s>] [--icon <emoji>]
//   workbook group list
//   workbook group members   --group <id>
//   workbook group invite <email> --group <id> [--role admin|member]
//   workbook group workbooks --group <id> [--q <query>] [--type <t>...] [--tag <t>...] [--include-archived]
//   workbook group archive  <wb-id> --group <id>
//   workbook group restore  <wb-id> --group <id>
//   workbook group rm       <wb-id> --group <id> [--yes]
//   workbook group purge    --group <id> [--hard] [--yes]
//   workbook group tags      --group <id>
//   workbook group tag-add   --group <id> <tag-id> [--label <s>] [--color <s>]
//   workbook group tag-rm    --group <id> <tag-id>
//
// Archive vs rm: archive hides a workbook from the group library while
// keeping it restorable. rm cascades — removes artifact, audit log,
// embedding index entry, and worker. Purge without --hard archives every
// active workbook (the "fresh group" flow used to clean stale demos out
// of UGC Pro); purge --hard removes every archived workbook permanently.
//
// Workbook-scoped tag membership:
//   workbook group tag-workbook  --workbook <id> --tag <a> --tag <b>  (replace set)

import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  apiPut,
  ensureBearer,
  DEFAULT_BROKER,
} from "../util/brokerClient.mjs";
import {
  cloneGroup,
  pullGroup,
  pushGroup,
  statusGroup,
} from "./groupSync.mjs";

export async function runGroup(flags) {
  const action = flags._?.[0];
  if (!action || action === "help" || action === "--help") return printUsage();
  const bearer = await ensureBearer({ force: flags["force-auth"] });
  const ctx = { bearer, broker: DEFAULT_BROKER };

  switch (action) {
    case "create":       return createGroup(flags, ctx);
    case "list":         return listGroups(ctx);
    case "members":      return listMembers(flags, ctx);
    case "workbooks":    return listWorkbooks(flags, ctx);
    case "archive":      return archiveWorkbook(flags, ctx);
    case "restore":      return restoreWorkbook(flags, ctx);
    case "rm":           return rmWorkbook(flags, ctx);
    case "purge":        return purgeGroup(flags, ctx);
    case "invite":       return invite(flags, ctx);
    case "tags":         return listTags(flags, ctx);
    case "tag-add":      return addTag(flags, ctx);
    case "tag-rm":       return rmTag(flags, ctx);
    case "tag-workbook": return tagWorkbook(flags, ctx);
    case "folder":       return folderSub(flags, ctx);
    case "mv":           return moveWorkbook(flags, ctx);
    case "export":       return exportManifest(flags, ctx);
    case "import":       return importManifest(flags, ctx);
    case "clone":        return cloneGroup(flags, ctx);
    case "pull":         return pullGroup(flags, ctx);
    case "push":         return pushGroup(flags, ctx);
    case "status":       return statusGroup(flags, ctx);
    case "help":         return printUsage();
    default:             usage(`unknown subcommand '${action}'`);
  }
}

// ── folders (wb-bz2 / wb-004) ────────────────────────────────────────

async function folderSub(flags, ctx) {
  const groupId = requireGroup(flags);
  const op = flags._?.[1];
  switch (op) {
    case "list":   return folderList(groupId, flags, ctx);
    case "mkdir":  return folderMkdir(groupId, flags, ctx);
    case "mv":     return folderMv(groupId, flags, ctx);
    case "rm":     return folderRm(groupId, flags, ctx);
    case "rename": return folderRename(groupId, flags, ctx);
    default:
      usage("workbook group folder <list|mkdir|mv|rm|rename> --group <id>");
  }
}

/** Flat list of all folders in the group. Indents by depth so agents
 *  can visually parse the tree without a separate tree endpoint. */
async function folderList(groupId, flags, ctx) {
  const r = await apiGet(`/v1/groups/${encodeURIComponent(groupId)}/folders`, ctx);
  const folders = r.folders ?? [];
  if (flags.json) {
    process.stdout.write(JSON.stringify(folders, null, 2) + "\n");
    return;
  }
  if (folders.length === 0) {
    process.stdout.write("No folders.\n");
    return;
  }
  const byParent = new Map();
  for (const f of folders) {
    const key = f.parent_folder_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(f);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  function walk(parent, depth) {
    for (const f of byParent.get(parent) ?? []) {
      process.stdout.write(`${"  ".repeat(depth)}${f.name}  (${f.id})\n`);
      walk(f.id, depth + 1);
    }
  }
  walk(null, 0);
}

async function folderMkdir(groupId, flags, ctx) {
  const name = flags._?.[2];
  if (!name) usage("workbook group folder mkdir <name> --group <id> [--parent <folder-id>]");
  const parentRaw = flags.parent ?? flags.p;
  const parent_folder_id =
    parentRaw && parentRaw !== "root" && parentRaw !== "--root" ? parentRaw : null;
  const r = await apiPost(
    `/v1/groups/${encodeURIComponent(groupId)}/folders`,
    { name, parent_folder_id },
    ctx,
  );
  if (flags.json) {
    process.stdout.write(JSON.stringify(r.folder, null, 2) + "\n");
  } else {
    process.stdout.write(`Created ${r.folder.id}  ${name}\n`);
  }
}

async function folderMv(groupId, flags, ctx) {
  const folderId = flags._?.[2];
  const destRaw = flags._?.[3] ?? flags.dest;
  if (!folderId || destRaw === undefined) {
    usage("workbook group folder mv <folder-id> <new-parent-id|--root> --group <id>");
  }
  const parent_folder_id =
    destRaw === "root" || destRaw === "--root" || destRaw === null ? null : destRaw;
  await apiPatch(
    `/v1/groups/${encodeURIComponent(groupId)}/folders/${encodeURIComponent(folderId)}`,
    { parent_folder_id },
    ctx,
  );
  process.stdout.write(
    `Moved ${folderId} → ${parent_folder_id ?? "(root)"}\n`,
  );
}

async function folderRm(groupId, flags, ctx) {
  const folderId = flags._?.[2];
  if (!folderId) usage("workbook group folder rm <folder-id> --group <id> [--cascade]");
  const cascade = flags.cascade ? "?cascade=true" : "";
  try {
    const r = await apiDelete(
      `/v1/groups/${encodeURIComponent(groupId)}/folders/${encodeURIComponent(folderId)}${cascade}`,
      ctx,
    );
    process.stdout.write(
      `Deleted ${folderId}${r.reparented ? ` (lifted ${r.reparented} item${r.reparented === 1 ? "" : "s"})` : ""}\n`,
    );
  } catch (e) {
    if (e.message?.includes("not_empty")) {
      process.stderr.write(
        `Folder is not empty. Re-run with --cascade to lift contents to the parent (workbooks are never deleted).\n`,
      );
      process.exit(2);
    }
    throw e;
  }
}

async function folderRename(groupId, flags, ctx) {
  const folderId = flags._?.[2];
  const name = flags._?.[3] ?? flags.name;
  if (!folderId || !name) {
    usage("workbook group folder rename <folder-id> <new-name> --group <id>");
  }
  await apiPatch(
    `/v1/groups/${encodeURIComponent(groupId)}/folders/${encodeURIComponent(folderId)}`,
    { name },
    ctx,
  );
  process.stdout.write(`Renamed ${folderId} → ${name}\n`);
}

// ── workbook mv ──────────────────────────────────────────────────────

async function moveWorkbook(flags, ctx) {
  const groupId = requireGroup(flags);
  const workbookId = flags._?.[1];
  const destRaw = flags._?.[2] ?? flags.dest;
  if (!workbookId || destRaw === undefined) {
    usage("workbook group mv <workbook-id> <folder-id|--root> --group <id>");
  }
  const folder_id =
    destRaw === "root" || destRaw === "--root" || destRaw === null ? null : destRaw;
  await apiPatch(
    `/v1/groups/${encodeURIComponent(groupId)}/workbooks/${encodeURIComponent(workbookId)}/folder`,
    { folder_id },
    ctx,
  );
  process.stdout.write(
    `Moved workbook ${workbookId} → ${folder_id ?? "(root)"}\n`,
  );
}

// ── manifest export / import (wb-43m) ────────────────────────────────

async function exportManifest(flags, ctx) {
  const groupId = requireGroup(flags);
  const manifest = await apiGet(
    `/v1/groups/${encodeURIComponent(groupId)}/manifest`,
    ctx,
  );
  const body = JSON.stringify(manifest, null, 2) + "\n";
  if (flags.out) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(flags.out, body);
    process.stderr.write(`Wrote ${flags.out}\n`);
  } else {
    process.stdout.write(body);
  }
}

async function importManifest(flags, ctx) {
  const groupId = requireGroup(flags);
  let raw;
  const file = flags._?.[1] ?? flags.in;
  if (file && file !== "-") {
    const fs = await import("node:fs/promises");
    raw = await fs.readFile(file, "utf8");
  } else {
    // Read manifest from stdin so it composes with `workbook group export`.
    raw = await readStdin();
  }
  let manifest;
  try { manifest = JSON.parse(raw); }
  catch (e) { usage(`bad JSON: ${e.message}`); }
  const r = await apiPost(
    `/v1/groups/${encodeURIComponent(groupId)}/manifest`,
    manifest,
    ctx,
  );
  const report = r.report ?? {};
  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    `Applied manifest:\n` +
      `  folders created : ${report.folders_created?.length ?? 0}\n` +
      `  folders updated : ${report.folders_updated?.length ?? 0}\n` +
      `  folders deleted : ${report.folders_deleted?.length ?? 0}\n` +
      `  workbooks moved : ${report.workbooks_moved?.length ?? 0}\n` +
      (report.workbooks_skipped_missing?.length
        ? `  workbooks skipped (not in group): ${report.workbooks_skipped_missing.length}\n`
        : ""),
  );
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function createGroup(flags, ctx) {
  const name = flags._?.[1];
  if (!name) {
    usage(
      `workbook group create <name> [--slug <s>] [--description <s>] [--icon <emoji>]`,
    );
  }

  // Slug rules echo the broker (lowercase, hyphenated, ≤32 chars).
  // We let the server have the final word on collision suffixes — see
  // /v1/groups POST in apps/workbooks-broker/src/routes/groups.ts.
  const body = {
    name,
    slug: flags.slug ?? undefined,
    description: flags.description ?? flags.desc ?? undefined,
  };
  if (typeof flags.icon === "string" && flags.icon.trim().length > 0) {
    body.icon = flags.icon.trim();
    body.icon_kind = "emoji";
  }

  const r = await apiPost("/v1/groups", body, ctx);
  process.stdout.write(
    [
      `Created group "${r.name}".`,
      `  id:    ${r.id}`,
      `  slug:  ${r.slug}`,
      `  role:  ${r.role}`,
      r.description ? `  about: ${r.description}` : null,
      ``,
      `Publish into it:`,
      `  workbook publish dist/<slug>.html --group ${r.id}`,
      ``,
      `Or invite:`,
      `  workbook group invite <email> --group ${r.id}`,
      ``,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
}

async function listGroups(ctx) {
  const r = await apiGet("/v1/groups/me", ctx);
  const groups = r.groups ?? [];
  if (groups.length === 0) {
    process.stdout.write("You aren't in any groups yet.\n");
    return;
  }
  const widest = Math.max(...groups.map((g) => g.name.length), 4);
  process.stdout.write(`${"NAME".padEnd(widest)}  ROLE     ID\n`);
  for (const g of groups) {
    process.stdout.write(
      `${g.name.padEnd(widest)}  ${g.role.padEnd(7)}  ${g.id}\n`,
    );
  }
}

async function listMembers(flags, ctx) {
  const groupId = requireGroup(flags);
  const r = await apiGet(`/v1/groups/${encodeURIComponent(groupId)}/members`, ctx);
  const members = r.members ?? [];
  const invites = r.invites ?? [];
  process.stdout.write(`Members (${members.length}):\n`);
  for (const m of members) {
    process.stdout.write(`  ${m.role.padEnd(7)} ${m.email ?? m.sub}\n`);
  }
  if (invites.length > 0) {
    process.stdout.write(`\nPending invites (${invites.length}):\n`);
    for (const i of invites) {
      process.stdout.write(`  ${i.role.padEnd(7)} ${i.email}\n`);
    }
  }
}

async function listWorkbooks(flags, ctx) {
  const groupId = requireGroup(flags);
  const qs = new URLSearchParams();
  if (flags.q) qs.set("q", flags.q);
  for (const t of toArray(flags.type)) qs.append("type", t);
  for (const t of toArray(flags.tag)) qs.append("tag", t);
  if (flags["include-revoked"]) qs.set("include_revoked", "1");
  if (flags["include-archived"]) qs.set("include_archived", "1");
  const path =
    `/v1/groups/${encodeURIComponent(groupId)}/workbooks` +
    (qs.toString() ? `?${qs}` : "");
  const r = await apiGet(path, ctx);
  const wbs = r.workbooks ?? [];
  if (wbs.length === 0) {
    process.stdout.write("No workbooks match.\n");
    return;
  }
  for (const w of wbs) {
    const title = w.title ?? w.slug ?? "(untitled)";
    const type = w.type ? ` [${w.type}]` : "";
    const tags = w.tags?.length ? `  #${w.tags.join(" #")}` : "";
    const status = w.revoked_at
      ? " (revoked)"
      : w.archived_at
        ? " (archived)"
        : "";
    process.stdout.write(`  ${w.id}  ${title}${type}${tags}${status}\n`);
  }
}

// ── archive / restore / rm / purge ───────────────────────────────────

async function archiveWorkbook(flags, ctx) {
  const groupId = requireGroup(flags);
  const wbId = flags._?.[1];
  if (!wbId) usage("workbook group archive <wb-id> --group <id>");
  await apiPost(
    `/v1/groups/${encodeURIComponent(groupId)}/workbooks/${encodeURIComponent(wbId)}/archive`,
    {},
    ctx,
  );
  process.stdout.write(`Archived ${wbId}.\n`);
}

async function restoreWorkbook(flags, ctx) {
  const groupId = requireGroup(flags);
  const wbId = flags._?.[1];
  if (!wbId) usage("workbook group restore <wb-id> --group <id>");
  await apiPost(
    `/v1/groups/${encodeURIComponent(groupId)}/workbooks/${encodeURIComponent(wbId)}/restore`,
    {},
    ctx,
  );
  process.stdout.write(`Restored ${wbId}.\n`);
}

async function rmWorkbook(flags, ctx) {
  const groupId = requireGroup(flags);
  const wbId = flags._?.[1];
  if (!wbId) usage("workbook group rm <wb-id> --group <id> [--yes]");
  if (!flags.yes) {
    usage(
      `'rm' is permanent — removes the artifact, audit log, and worker.\n` +
        `Re-run with --yes to confirm:\n` +
        `  workbook group rm ${wbId} --group ${groupId} --yes`,
    );
  }
  await apiDelete(
    `/v1/groups/${encodeURIComponent(groupId)}/workbooks/${encodeURIComponent(wbId)}`,
    ctx,
  );
  process.stdout.write(`Deleted ${wbId}.\n`);
}

// Bulk cleanup. Default archives every live workbook in the group (the
// "fresh group" flow). --hard hard-deletes every archived workbook —
// permanent garbage collection of the archive bucket.
async function purgeGroup(flags, ctx) {
  const groupId = requireGroup(flags);
  const hard = !!flags.hard;

  const listing = await apiGet(
    `/v1/groups/${encodeURIComponent(groupId)}/workbooks?include_archived=1`,
    ctx,
  );
  const all = listing.workbooks ?? [];
  const targets = hard
    ? all.filter((w) => w.archived_at != null)
    : all.filter((w) => w.archived_at == null && w.revoked_at == null);

  if (targets.length === 0) {
    process.stdout.write(
      hard
        ? "No archived workbooks to delete.\n"
        : "No active workbooks to archive.\n",
    );
    return;
  }

  const verb = hard ? "DELETE FOREVER" : "Archive";
  process.stdout.write(`${verb} ${targets.length} workbook(s) in this group:\n`);
  for (const w of targets) {
    process.stdout.write(`  ${w.id}  ${w.title ?? w.slug ?? "(untitled)"}\n`);
  }
  if (!flags.yes) {
    process.stderr.write(
      `\nRe-run with --yes to confirm:\n` +
        `  workbook group purge --group ${groupId}${hard ? " --hard" : ""} --yes\n`,
    );
    process.exit(1);
  }

  let ok = 0;
  let failed = 0;
  for (const w of targets) {
    try {
      if (hard) {
        await apiDelete(
          `/v1/groups/${encodeURIComponent(groupId)}/workbooks/${encodeURIComponent(w.id)}`,
          ctx,
        );
      } else {
        await apiPost(
          `/v1/groups/${encodeURIComponent(groupId)}/workbooks/${encodeURIComponent(w.id)}/archive`,
          {},
          ctx,
        );
      }
      ok++;
    } catch (e) {
      failed++;
      process.stderr.write(`  ! ${w.id}: ${e.message}\n`);
    }
  }
  process.stdout.write(
    `${hard ? "Deleted" : "Archived"} ${ok}/${targets.length}` +
      (failed > 0 ? ` (${failed} failed)` : "") +
      ".\n",
  );
  if (failed > 0) process.exit(1);
}

async function listTags(flags, ctx) {
  const groupId = requireGroup(flags);
  const r = await apiGet(`/v1/groups/${encodeURIComponent(groupId)}/tags`, ctx);
  const dict = r.dictionary ?? [];
  const inUse = new Set(r.in_use ?? []);
  if (dict.length === 0 && inUse.size === 0) {
    process.stdout.write("No tags yet.\n");
    return;
  }
  const all = new Set([...dict.map((d) => d.tag_id), ...inUse]);
  for (const id of [...all].sort()) {
    const d = dict.find((x) => x.tag_id === id);
    const label = d?.label ? `  ${d.label}` : "";
    const used = inUse.has(id) ? "" : "  (defined, not in use)";
    process.stdout.write(`  ${id}${label}${used}\n`);
  }
}

async function addTag(flags, ctx) {
  const groupId = requireGroup(flags);
  const tag_id = flags._?.[1];
  if (!tag_id) usage("workbook group tag-add <tag-id> --group <id>");
  await apiPost(
    `/v1/groups/${encodeURIComponent(groupId)}/tags`,
    { tag_id, label: flags.label ?? null, color: flags.color ?? null },
    ctx,
  );
  process.stdout.write(`Added tag ${tag_id}.\n`);
}

async function rmTag(flags, ctx) {
  const groupId = requireGroup(flags);
  const tag_id = flags._?.[1];
  if (!tag_id) usage("workbook group tag-rm <tag-id> --group <id>");
  await apiDelete(
    `/v1/groups/${encodeURIComponent(groupId)}/tags/${encodeURIComponent(tag_id)}`,
    ctx,
  );
  process.stdout.write(`Removed tag ${tag_id} from dictionary.\n`);
}

async function tagWorkbook(flags, ctx) {
  const wbId = flags.workbook ?? flags.w;
  if (!wbId) usage("workbook group tag-workbook --workbook <id> --tag <a> [--tag <b>]");
  const tags = toArray(flags.tag);
  await apiPut(
    `/v1/workbooks/${encodeURIComponent(wbId)}/tags`,
    { tags },
    ctx,
  );
  process.stdout.write(`Set tags on ${wbId}: ${tags.length ? tags.join(", ") : "(cleared)"}\n`);
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

async function invite(flags, ctx) {
  const email = flags._?.[1];
  if (!email) usage("workbook group invite <email> --group <id>");
  const groupId = requireGroup(flags);
  const role = flags.role === "admin" ? "admin" : "member";
  const r = await apiPost(
    `/v1/groups/${encodeURIComponent(groupId)}/invites`,
    { email, role },
    ctx,
  );
  process.stdout.write(`Invited ${email} as ${role} (invite ${r.id}).\n`);
}

function requireGroup(flags) {
  const groupId = flags.group ?? flags.g;
  if (!groupId) usage("--group <id> is required");
  return groupId;
}

function usage(msg) {
  if (msg) process.stderr.write(`workbook group: ${msg}\n\n`);
  printUsage();
  process.exit(2);
}

function printUsage() {
  process.stdout.write(
    [
      "workbook group <subcommand>",
      "",
      "Subcommands:",
      "  create <name> [--slug <s>] [--description <s>] [--icon <emoji>]",
      "                                        create a new group; caller becomes admin",
      "  list                                  groups you belong to",
      "  members    --group <id>               roster + pending invites",
      "  workbooks  --group <id> [--q <s>] [--type <t>] [--tag <t>] [--include-archived]",
      "                                        list workbooks; filter by query, type, tag",
      "  archive <wb-id> --group <id>          hide from library, keep restorable",
      "  restore <wb-id> --group <id>          un-archive",
      "  rm      <wb-id> --group <id> --yes    hard delete (artifact + audit + worker)",
      "  purge           --group <id> [--hard] [--yes]",
      "                                        bulk: archive every active workbook,",
      "                                        or with --hard delete every archived one",
      "  invite <email> --group <id> [--role admin|member]",
      "                                        send an email invite",
      "  tags       --group <id>               tag dictionary + tags in use",
      "  tag-add <id> --group <id> [--label <s>] [--color <s>]",
      "                                        define a tag in the dictionary",
      "  tag-rm  <id> --group <id>             remove a tag from the dictionary",
      "  tag-workbook --workbook <id> --tag <a> [--tag <b>]",
      "                                        replace the workbook's tag set",
      "",
      "  folder list   --group <id> [--json]   tree of folders in the group",
      "  folder mkdir <name> --group <id> [--parent <folder-id>]",
      "                                        create a folder (parent omitted = root)",
      "  folder mv     <folder-id> <new-parent-id|--root> --group <id>",
      "                                        reparent a folder; rejected if it creates a cycle",
      "  folder rm     <folder-id> --group <id> [--cascade]",
      "                                        delete a folder; --cascade lifts contents up",
      "  folder rename <folder-id> <new-name>  --group <id>",
      "  mv     <workbook-id> <folder-id|--root> --group <id>",
      "                                        move a workbook to a folder",
      "",
      "  export --group <id> [--out file.json] dump folders + workbook positions as a manifest",
      "  import --group <id> [file|-]          apply a manifest (stdin if file omitted/'-')",
      "",
      "  clone  <group-id> [path] [--git] [--force]",
      "                                        download a group to a local working copy",
      "  status [path] [--json]                diff a working copy vs the broker",
      "  pull   [path] [--force]               fetch broker state and reconcile with local",
      "  push   [path] [--dry-run]             upload local manifest to the broker",
      "",
    ].join("\n"),
  );
}
