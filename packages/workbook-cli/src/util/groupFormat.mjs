// Group working-copy file format (wb-67a).
//
// Canonical layout + escape rules documented in
// packages/workbooks/docs/GROUP_FORMAT.md. This module is the single
// place tooling agrees on:
//   - how broker manifest <→> on-disk paths
//   - how folder + workbook names get filesystem-safe
//   - how we walk a local working copy to reconstruct state

import fs from "node:fs/promises";
import path from "node:path";

export const GROUP_MARKER = ".workbooks-group.json";
export const FORMAT_VERSION = 1;

const DIVISION_SLASH = "∕"; // "∕" — non-path-separator visual look-alike
const FS_UNSAFE = /[\\\/:*?"<>|\x00-\x1f]/g;

/** Make a folder or workbook name safe to use as a path segment. */
export function escapeName(name) {
  return String(name).replace(FS_UNSAFE, (ch) => {
    if (ch === "/" || ch === "\\") return DIVISION_SLASH;
    return "_";
  });
}

/** Best-effort reverse of escapeName for display. We can't fully
 *  invert (the original `:` we replaced with `_` is unrecoverable),
 *  but the manifest's `name` field is authoritative anyway — this is
 *  only used when we discover an untracked folder on disk. */
export function unescapeName(safe) {
  return String(safe).replaceAll(DIVISION_SLASH, "/");
}

/** Derive the on-disk `.html` filename for a workbook. Prefers the
 *  workbook's slug; falls back to the id if no slug is set. */
export function workbookFilename(wb) {
  const base = wb.slug && wb.slug.length > 0 ? wb.slug : wb.id;
  return `${escapeName(base)}.html`;
}

/** Compute on-disk relative paths for every folder + workbook in a
 *  broker manifest. Returns the augmented working-copy shape ready to
 *  serialize as .workbooks-group.json. */
export function buildWorkingCopy({ brokerUrl, groupId, manifest }) {
  const byParent = new Map();
  for (const f of manifest.folders) {
    const key = f.parent_folder_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(f);
    byParent.set(key, list);
  }
  const pathById = new Map();
  pathById.set(null, "");
  // Stable, deterministic ordering: BFS from root, siblings alphabetical.
  const queue = [null];
  while (queue.length) {
    const parent = queue.shift();
    const children = (byParent.get(parent) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const f of children) {
      const parentPath = pathById.get(parent) ?? "";
      const segment = escapeName(f.name);
      pathById.set(f.id, parentPath ? `${parentPath}/${segment}` : segment);
      queue.push(f.id);
    }
  }

  const folders = manifest.folders.map((f) => ({
    id: f.id,
    parent_folder_id: f.parent_folder_id ?? null,
    name: f.name,
    path: pathById.get(f.id) ?? escapeName(f.name),
  }));

  const workbooks = manifest.workbooks.map((w) => {
    const folderPath = pathById.get(w.folder_id ?? null) ?? "";
    const file = workbookFilename(w);
    return {
      id: w.id,
      folder_id: w.folder_id ?? null,
      slug: w.slug ?? w.id,
      title: w.title ?? null,
      type: w.type ?? null,
      path: folderPath ? `${folderPath}/${file}` : file,
    };
  });

  return {
    version: FORMAT_VERSION,
    broker: { url: brokerUrl, group_id: groupId },
    group: {
      name: manifest.group.name,
      description: manifest.group.description ?? null,
    },
    folders,
    workbooks,
  };
}

/** Strip working-copy-only fields and produce the broker-shaped
 *  manifest that POST /v1/groups/:id/manifest expects. */
export function toBrokerManifest(workingCopy) {
  return {
    version: 1,
    group: {
      name: workingCopy.group.name,
      description: workingCopy.group.description ?? null,
    },
    folders: workingCopy.folders.map((f) => ({
      id: f.id,
      parent_folder_id: f.parent_folder_id ?? null,
      name: f.name,
    })),
    workbooks: workingCopy.workbooks.map((w) => ({
      id: w.id,
      folder_id: w.folder_id ?? null,
      title: w.title ?? null,
      type: w.type ?? null,
    })),
  };
}

/** Read .workbooks-group.json from a working-copy root. Throws if
 *  missing or malformed; the caller decides whether that's fatal. */
export async function readWorkingCopy(rootPath) {
  const file = path.join(rootPath, GROUP_MARKER);
  const raw = await fs.readFile(file, "utf8");
  const wc = JSON.parse(raw);
  if (wc.version !== FORMAT_VERSION) {
    throw new Error(
      `${GROUP_MARKER}: version ${wc.version} (this CLI handles ${FORMAT_VERSION})`,
    );
  }
  return wc;
}

/** Serialize a working-copy + write it to disk. */
export async function writeWorkingCopy(rootPath, workingCopy) {
  const file = path.join(rootPath, GROUP_MARKER);
  await fs.writeFile(file, JSON.stringify(workingCopy, null, 2) + "\n");
}

/** Walk a working-copy directory and report what's actually on disk.
 *  Returns parallel arrays of folder paths and workbook .html files,
 *  each tagged with whether the manifest expects them. The diff engine
 *  combines this with the manifest to produce status output. */
export async function scanLocal(rootPath, workingCopy) {
  const knownFolderPaths = new Set(workingCopy.folders.map((f) => f.path));
  const knownWorkbookPaths = new Set(workingCopy.workbooks.map((w) => w.path));

  const seenFolders = new Set();
  const seenWorkbooks = new Set();
  const untrackedFiles = [];

  async function walk(rel) {
    const abs = path.join(rootPath, rel);
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        seenFolders.add(childRel);
        await walk(childRel);
      } else if (e.isFile() && e.name.endsWith(".html")) {
        if (knownWorkbookPaths.has(childRel)) {
          seenWorkbooks.add(childRel);
        } else {
          untrackedFiles.push(childRel);
        }
      }
    }
  }

  await walk("");
  return {
    seenFolders,
    seenWorkbooks,
    untrackedFiles,
    missingFolders: [...knownFolderPaths].filter((p) => !seenFolders.has(p)),
    missingWorkbooks: [...knownWorkbookPaths].filter((p) => !seenWorkbooks.has(p)),
  };
}

const DEFAULT_GITIGNORE = `# workbook group working copy
node_modules/
.DS_Store
*.workbook.html.bak
dist/
.env
.env.*
`;

export const DEFAULT_GITIGNORE_CONTENT = DEFAULT_GITIGNORE;
