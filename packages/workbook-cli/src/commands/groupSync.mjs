// `workbook group clone / pull / push / status` (wb-67a).
//
// Layer 1 of the group-sync story: local working copies of a group,
// synced with the broker via the manifest endpoint (wb-43m). On-disk
// format is documented in packages/workbooks/docs/GROUP_FORMAT.md.
//
// Layer 2 — git workflows — is just `git init` over the working copy;
// the optional --git flag on `clone` does the init + initial commit.
//
// Layer 3 — broker-side GitHub integration — is tracked in wb-97c
// (separate epic, depends on this).

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  apiGet,
  apiPost,
  DEFAULT_BROKER,
} from "../util/brokerClient.mjs";
import {
  GROUP_MARKER,
  buildWorkingCopy,
  toBrokerManifest,
  readWorkingCopy,
  writeWorkingCopy,
  scanLocal,
  workbookFilename,
  escapeName,
  DEFAULT_GITIGNORE_CONTENT,
} from "../util/groupFormat.mjs";
import { diffGroups, formatDiff } from "../util/groupDiff.mjs";

// ── clone ────────────────────────────────────────────────────────────

export async function cloneGroup(flags, ctx) {
  const groupRef = flags._?.[1];
  if (!groupRef) usage("workbook group clone <group-id> [path] [--git] [--force]");
  // Strip an accidental URL prefix — accept either a bare id or a
  // workbooks.sh URL that ends in /g/<id>.
  const groupId = groupRef.includes("/")
    ? groupRef.split("/").filter(Boolean).pop()
    : groupRef;

  // Fetch the group's slug (broker manifest doesn't include it, so we
  // hit /v1/groups/:id for the metadata).
  const [manifest, groupMeta] = await Promise.all([
    apiGet(`/v1/groups/${encodeURIComponent(groupId)}/manifest`, ctx),
    apiGet(`/v1/groups/${encodeURIComponent(groupId)}`, ctx).catch(() => null),
  ]);

  // Default target dir name = group slug, falling back to a sanitized name.
  const dirHint =
    groupMeta?.slug ?? escapeName(manifest.group?.name ?? groupId);
  const target = path.resolve(flags._?.[2] ?? dirHint);

  let exists = false;
  try {
    const entries = await fs.readdir(target);
    exists = entries.length > 0;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (exists && !flags.force) {
    process.stderr.write(
      `${target} exists and is not empty. Re-run with --force to overwrite.\n`,
    );
    process.exit(2);
  }

  await fs.mkdir(target, { recursive: true });

  const workingCopy = buildWorkingCopy({
    brokerUrl: ctx.broker ?? DEFAULT_BROKER,
    groupId,
    manifest,
  });

  // 1) Create every folder dir.
  for (const f of workingCopy.folders) {
    await fs.mkdir(path.join(target, f.path), { recursive: true });
  }

  // 2) Download every workbook artifact.
  const broker = ctx.broker ?? DEFAULT_BROKER;
  let downloaded = 0;
  let failed = 0;
  for (const w of workingCopy.workbooks) {
    const dest = path.join(target, w.path);
    try {
      // `?full=1` — preserve the embedded source bundle so the cloned
      // artifact can be `workbook unbundle`'d locally. Without it the
      // broker returns the "view" variant (bundle stripped).
      const r = await fetch(`${broker}/v1/workbooks/${encodeURIComponent(w.id)}/artifact?full=1`, {
        headers: { authorization: `Bearer ${ctx.bearer}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.writeFile(dest, buf);
      downloaded++;
    } catch (e) {
      // Leave a placeholder so the manifest position is preserved on
      // disk even if this artifact is unavailable.
      await fs.writeFile(
        dest,
        `<!-- workbook ${w.id}: download failed (${e.message}). Re-run \`workbook group pull\` to retry. -->\n`,
      );
      failed++;
    }
  }

  await writeWorkingCopy(target, workingCopy);

  if (flags.git) {
    await initGit(target);
  }

  process.stdout.write(
    `Cloned ${manifest.group?.name ?? groupId} to ${target}\n` +
      `  folders   : ${workingCopy.folders.length}\n` +
      `  workbooks : ${downloaded} downloaded${failed ? `, ${failed} placeholders` : ""}\n` +
      (flags.git ? `  git       : initialized\n` : ""),
  );
}

async function initGit(target) {
  await fs.writeFile(path.join(target, ".gitignore"), DEFAULT_GITIGNORE_CONTENT);
  const opts = { cwd: target, stdio: "inherit" };
  const res = spawnSync("git", ["init", "--quiet"], opts);
  if (res.status !== 0) {
    process.stderr.write("git init failed; skipping initial commit\n");
    return;
  }
  spawnSync("git", ["add", "-A"], opts);
  spawnSync("git", ["commit", "--quiet", "-m", "workbook group clone"], opts);
}

// ── status ───────────────────────────────────────────────────────────

export async function statusGroup(flags, ctx) {
  const target = path.resolve(flags._?.[1] ?? ".");
  const wc = await readWorkingCopy(target).catch(() => null);
  if (!wc) {
    process.stderr.write(
      `${target}: not a workbook group working copy (no ${GROUP_MARKER}). ` +
        `Run \`workbook group clone <id>\` first.\n`,
    );
    process.exit(2);
  }

  const remote = await apiGet(
    `/v1/groups/${encodeURIComponent(wc.broker.group_id)}/manifest`,
    { ...ctx, broker: wc.broker.url ?? ctx.broker ?? DEFAULT_BROKER },
  );

  const diff = diffGroups(remote, wc);
  const scan = await scanLocal(target, wc);

  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ diff, untracked: scan.untrackedFiles, missing_on_disk: scan.missingWorkbooks }, null, 2) +
        "\n",
    );
    return diff;
  }

  if (diff.clean && scan.untrackedFiles.length === 0 && scan.missingWorkbooks.length === 0) {
    process.stdout.write("Clean — working copy matches remote.\n");
    return diff;
  }

  process.stdout.write(`Group ${wc.broker.group_id} @ ${target}\n`);
  process.stdout.write(formatDiff(diff));
  if (scan.untrackedFiles.length > 0) {
    process.stdout.write(`  untracked files on disk:\n`);
    for (const f of scan.untrackedFiles) process.stdout.write(`    ? ${f}\n`);
  }
  if (scan.missingWorkbooks.length > 0) {
    process.stdout.write(`  manifest files missing on disk:\n`);
    for (const f of scan.missingWorkbooks) process.stdout.write(`    ! ${f}\n`);
    process.stdout.write(`    (run \`workbook group pull\` to refetch)\n`);
  }
  return diff;
}

// ── pull ─────────────────────────────────────────────────────────────

export async function pullGroup(flags, ctx) {
  const target = path.resolve(flags._?.[1] ?? ".");
  const wc = await readWorkingCopy(target);

  const broker = wc.broker.url ?? ctx.broker ?? DEFAULT_BROKER;
  const remote = await apiGet(
    `/v1/groups/${encodeURIComponent(wc.broker.group_id)}/manifest`,
    { ...ctx, broker },
  );

  const diff = diffGroups(remote, wc);
  const hasLocalDrift =
    diff.folderRemoved.length > 0 ||
    diff.workbookRemoved.length > 0 ||
    diff.workbookMoved.some((m) => {
      // A move is "local drift" only if the local position differs
      // from what we *think* the local has — for pull we treat any
      // diverging local position as drift requiring --force.
      return true;
    });

  if (hasLocalDrift && !flags.force) {
    process.stderr.write(
      `Local has changes the remote doesn't know about. Re-run with --force to overwrite, or push your local changes first:\n\n`,
    );
    process.stderr.write(formatDiff(diff));
    process.exit(2);
  }

  // Rebuild the working copy from the new manifest, then reconcile
  // the on-disk tree against it.
  const fresh = buildWorkingCopy({
    brokerUrl: broker,
    groupId: wc.broker.group_id,
    manifest: remote,
  });

  // 1) Create new folders.
  for (const f of fresh.folders) {
    await fs.mkdir(path.join(target, f.path), { recursive: true });
  }

  // 2) Move workbooks whose path changed (folder move, rename, etc).
  const oldPaths = new Map(wc.workbooks.map((w) => [w.id, w.path]));
  const newPaths = new Map(fresh.workbooks.map((w) => [w.id, w.path]));
  for (const [id, newP] of newPaths) {
    const oldP = oldPaths.get(id);
    if (oldP && oldP !== newP) {
      const src = path.join(target, oldP);
      const dst = path.join(target, newP);
      try {
        await fs.rename(src, dst);
      } catch (e) {
        if (e.code === "ENOENT") {
          // Source isn't on disk — re-download below.
        } else {
          throw e;
        }
      }
    }
  }

  // 3) Download any workbooks that weren't there before (or whose
  //    rename failed because the source was missing).
  for (const w of fresh.workbooks) {
    const dest = path.join(target, w.path);
    try {
      await fs.access(dest);
    } catch {
      try {
        const r = await fetch(`${broker}/v1/workbooks/${encodeURIComponent(w.id)}/artifact?full=1`, {
          headers: { authorization: `Bearer ${ctx.bearer}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        await fs.writeFile(dest, buf);
      } catch (e) {
        await fs.writeFile(
          dest,
          `<!-- workbook ${w.id}: download failed (${e.message}) -->\n`,
        );
      }
    }
  }

  // 4) Remove workbook files for ids no longer in the remote.
  for (const old of wc.workbooks) {
    if (!newPaths.has(old.id)) {
      await fs.rm(path.join(target, old.path), { force: true });
    }
  }

  // 5) Remove folder dirs that are gone (after their contents already
  //    moved out). Recursive rm only if the dir is empty after moves.
  const remoteFolderIds = new Set(fresh.folders.map((f) => f.id));
  for (const oldF of wc.folders) {
    if (!remoteFolderIds.has(oldF.id)) {
      const dir = path.join(target, oldF.path);
      try {
        const entries = await fs.readdir(dir);
        if (entries.length === 0) await fs.rmdir(dir);
        // Non-empty stale folder → user has untracked content there; leave it.
      } catch { /* already gone */ }
    }
  }

  await writeWorkingCopy(target, fresh);

  process.stdout.write(
    `Pulled ${fresh.group.name}:\n` +
      `  folders   added : ${diff.folderAdded.length}, removed : ${diff.folderRemoved.length}, changed : ${diff.folderChanged.length}\n` +
      `  workbooks added : ${diff.workbookAdded.length}, removed : ${diff.workbookRemoved.length}, moved : ${diff.workbookMoved.length}\n`,
  );
}

// ── push ─────────────────────────────────────────────────────────────

export async function pushGroup(flags, ctx) {
  const target = path.resolve(flags._?.[1] ?? ".");
  const wc = await readWorkingCopy(target);

  const broker = wc.broker.url ?? ctx.broker ?? DEFAULT_BROKER;

  // Pre-flight: warn about untracked files so users know push won't
  // upload them.
  const scan = await scanLocal(target, wc);
  if (scan.untrackedFiles.length > 0 && !flags.quiet) {
    process.stderr.write(
      `Note: ${scan.untrackedFiles.length} untracked file(s) on disk will not be pushed:\n`,
    );
    for (const f of scan.untrackedFiles.slice(0, 5)) {
      process.stderr.write(`  ? ${f}\n`);
    }
    if (scan.untrackedFiles.length > 5) {
      process.stderr.write(`  … and ${scan.untrackedFiles.length - 5} more\n`);
    }
  }

  if (flags["dry-run"]) {
    const remote = await apiGet(
      `/v1/groups/${encodeURIComponent(wc.broker.group_id)}/manifest`,
      { ...ctx, broker },
    );
    const diff = diffGroups(wc, remote); // local treated as the "new" state
    process.stdout.write(formatDiff(diff, { remoteLabel: "local", localLabel: "broker" }));
    return;
  }

  const manifest = toBrokerManifest(wc);
  const r = await apiPost(
    `/v1/groups/${encodeURIComponent(wc.broker.group_id)}/manifest`,
    manifest,
    { ...ctx, broker },
  );

  const report = r.report ?? {};
  process.stdout.write(
    `Pushed ${wc.group.name}:\n` +
      `  folders created : ${report.folders_created?.length ?? 0}\n` +
      `  folders updated : ${report.folders_updated?.length ?? 0}\n` +
      `  folders deleted : ${report.folders_deleted?.length ?? 0}\n` +
      `  workbooks moved : ${report.workbooks_moved?.length ?? 0}\n` +
      (report.workbooks_skipped_missing?.length
        ? `  workbooks not in group (skipped): ${report.workbooks_skipped_missing.length}\n`
        : ""),
  );
}

function usage(msg) {
  process.stderr.write(`workbook group: ${msg}\n`);
  process.exit(2);
}
