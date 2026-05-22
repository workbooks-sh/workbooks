// Group-working-copy diff engine (wb-67a.3).
//
// Single source of truth for `workbook group status / pull / push`.
// Compares a broker manifest against a local working copy and reports
// every meaningful divergence.

/** @typedef {{
 *    folders: Array<{ id: string; parent_folder_id: string|null; name: string }>;
 *    workbooks: Array<{ id: string; folder_id: string|null; title?: string|null; type?: string|null }>;
 *  }} BrokerManifest
 */

/** Diff a broker manifest against the in-memory working copy. Both
 *  are expected to be normalized (parent_folder_id explicit null,
 *  folder_id explicit null). Returns six buckets.
 */
export function diffGroups(remote, local) {
  const remoteFolders = new Map(remote.folders.map((f) => [f.id, f]));
  const localFolders = new Map(local.folders.map((f) => [f.id, f]));
  const remoteWorkbooks = new Map(remote.workbooks.map((w) => [w.id, w]));
  const localWorkbooks = new Map(local.workbooks.map((w) => [w.id, w]));

  const folderAdded = []; // in remote, not in local
  const folderRemoved = []; // in local, not in remote
  const folderChanged = []; // name or parent differs
  for (const [id, rf] of remoteFolders) {
    const lf = localFolders.get(id);
    if (!lf) folderAdded.push(rf);
    else if (
      rf.name !== lf.name ||
      (rf.parent_folder_id ?? null) !== (lf.parent_folder_id ?? null)
    ) {
      folderChanged.push({ id, remote: rf, local: lf });
    }
  }
  for (const [id, lf] of localFolders) {
    if (!remoteFolders.has(id)) folderRemoved.push(lf);
  }

  const workbookAdded = [];
  const workbookRemoved = [];
  const workbookMoved = [];
  for (const [id, rw] of remoteWorkbooks) {
    const lw = localWorkbooks.get(id);
    if (!lw) workbookAdded.push(rw);
    else if ((rw.folder_id ?? null) !== (lw.folder_id ?? null)) {
      workbookMoved.push({ id, remote: rw, local: lw });
    }
  }
  for (const [id, lw] of localWorkbooks) {
    if (!remoteWorkbooks.has(id)) workbookRemoved.push(lw);
  }

  return {
    folderAdded,
    folderRemoved,
    folderChanged,
    workbookAdded,
    workbookRemoved,
    workbookMoved,
    clean:
      folderAdded.length === 0 &&
      folderRemoved.length === 0 &&
      folderChanged.length === 0 &&
      workbookAdded.length === 0 &&
      workbookRemoved.length === 0 &&
      workbookMoved.length === 0,
  };
}

/** Render a diff as a human-readable status block. */
export function formatDiff(diff, { remoteLabel = "remote", localLabel = "local" } = {}) {
  if (diff.clean) return "Working copy matches remote.\n";
  const lines = [];
  const section = (header, items, render) => {
    if (items.length === 0) return;
    lines.push(`  ${header}:`);
    for (const it of items) lines.push(`    ${render(it)}`);
  };

  section(`folders only in ${remoteLabel}`, diff.folderAdded, (f) => `+ ${f.name}  (${f.id})`);
  section(`folders only in ${localLabel}`, diff.folderRemoved, (f) => `- ${f.name}  (${f.id})`);
  section(`folders renamed or reparented`, diff.folderChanged, (c) =>
    `~ ${c.local.name} → ${c.remote.name}  (${c.id})`,
  );
  section(`workbooks only in ${remoteLabel}`, diff.workbookAdded, (w) =>
    `+ ${w.title ?? w.id}  (${w.id})`,
  );
  section(`workbooks only in ${localLabel}`, diff.workbookRemoved, (w) =>
    `- ${w.title ?? w.id}  (${w.id})`,
  );
  section(`workbooks moved`, diff.workbookMoved, (c) =>
    `~ ${c.remote.title ?? c.id}  ${c.local.folder_id ?? "(root)"} → ${c.remote.folder_id ?? "(root)"}`,
  );

  return lines.join("\n") + "\n";
}
