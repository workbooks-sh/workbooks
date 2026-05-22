# Workbook Group Format (v1)

A **workbook group** is portable: any directory whose root holds a
`.workbooks-group.json` file is a valid group working copy. The format
is the OSS portability contract — Studio's broker is *one* host, but
the directory itself is the source of truth that travels.

The format is designed to round-trip cleanly through `git` and through
the broker's manifest endpoints, so a group can be:

- Cloned with `workbook group clone <group-id>` and pushed to GitHub.
- Hosted statically on any web server (the recipient gets the .html
  workbooks directly; the .json describes the tree).
- Edited offline and synced back via `workbook group push`.
- Forked by checking out the git repo into a new path and re-pointing
  `broker.group_id` at a new group.

## Root layout

```
my-group/
├── .workbooks-group.json     ← the manifest + broker pointer (REQUIRED)
├── .gitignore                ← recommended defaults
├── marketing/                ← one directory per folder in the tree
│   ├── q4-roadmap.html       ← workbook artifact at its manifest position
│   └── deep-dives/           ← nested folder
│       └── churn-cohorts.html
└── design/
    └── system-tokens.html
```

Rules:

- The root of a working copy contains `.workbooks-group.json` and
  nothing else mandatory. Other files (e.g. `README.md`, `.git/`,
  `node_modules/`) are ignored by tooling.
- Every folder in the manifest tree corresponds to a directory on
  disk. Directory names match `folders[].name` exactly (after
  filesystem-safe escaping; see *Path escaping* below).
- Every workbook in the manifest corresponds to a `<slug>.html` file
  at its folder position. Workbooks at the group root sit directly
  inside the root directory.
- Files and directories that exist on disk but aren't in the manifest
  are ignored by `pull` (they're untracked) and stripped by `push`
  unless they appear in `.gitignore` (then they're left alone but
  still untracked from the manifest's perspective).

## `.workbooks-group.json` schema

```json
{
  "version": 1,
  "broker": {
    "url": "https://auth.workbooks.sh",
    "group_id": "Y3l4N2Q2OG10ZndhYjJxbA"
  },
  "group": {
    "name": "Acme Marketing",
    "description": "Public-facing analyses for the Acme marketing team."
  },
  "folders": [
    {
      "id": "marketing",
      "parent_folder_id": null,
      "name": "marketing",
      "path": "marketing"
    },
    {
      "id": "deep-dives",
      "parent_folder_id": "marketing",
      "name": "deep-dives",
      "path": "marketing/deep-dives"
    }
  ],
  "workbooks": [
    {
      "id": "k_PqRsTuVw_2Y",
      "folder_id": "marketing",
      "slug": "q4-roadmap",
      "path": "marketing/q4-roadmap.html",
      "title": "Q4 Roadmap",
      "type": "presentation"
    }
  ]
}
```

### Difference from the broker manifest (`group.workbooks.json`)

The broker exposes a simpler shape (`GroupManifest`) over HTTP — just
folders + workbooks with parent pointers. The on-disk
`.workbooks-group.json` adds three things:

| Field                    | Why                                                 |
| ------------------------ | --------------------------------------------------- |
| `broker.url, group_id`   | Where this working copy syncs to.                   |
| `folders[].path`         | Pre-computed relative path so tools don't re-walk.  |
| `workbooks[].path, slug` | Same — relative path to the .html on disk.          |

`path` is always relative, uses forward slashes (cross-platform), and
includes the `.html` suffix for workbooks. It's authoritative: if
`path` and the parent chain disagree, `path` wins (the tree on disk is
the truth; chain entries are informational).

### Versioning

The top-level `version: 1` is the on-disk schema. Future incompatible
changes bump it; tooling refuses to operate on `version > 1` and warns
on `version < 1`.

## Path escaping

Folder and workbook names are user-input strings. To make them
filesystem-safe:

- Forward slashes (`/`) in names are replaced with `∕` (division
  slash). Reverse on read.
- Reserved Windows names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`,
  `LPT1-9`) get a leading underscore on disk.
- Names that would collide after normalization (e.g. two folders named
  `Reports` and `reports` in the same parent on a case-insensitive
  filesystem) get a `~<short-id>` suffix on the second one.
- Names that exceed 200 bytes after UTF-8 encoding are truncated and
  suffixed with `~<short-id>` to disambiguate.

Tooling preserves the original name in `folders[].name` /
`workbooks[].slug`; only the on-disk path uses the escaped form.

## `.gitignore` defaults

When `workbook group clone --git` initializes a repo, this is the
default `.gitignore`:

```
node_modules/
.DS_Store
*.workbook.html.bak
dist/
.env
.env.*
```

The .html artifacts themselves are **tracked by default** — they're
the deliverable. `.env*` is excluded so accidentally-committed
credentials don't leak via the manifest path. Add to taste.

## Compatibility with the broker manifest endpoint

`workbook group push` builds a broker-shaped `GroupManifest` from the
on-disk tree (dropping the `broker.*` and `path` fields, keeping just
folders + workbooks with ids and parent pointers) and POSTs to
`/v1/groups/:id/manifest`. The 3-pass apply algorithm in
`apps/workbooks-broker/src/lib/manifest.ts` makes this idempotent.

`workbook group pull` does the inverse: GET the broker manifest,
augment with `broker.*` + `path` fields, write to disk, then
reconcile any moved or removed folders/workbooks.

## Git workflows

Because the working copy is plain files, normal `git` works:

```bash
workbook group clone my-team --git
cd my-team
gh repo create acme/workbooks-marketing --private --push
# … edit files locally, commit, push …
workbook group push    # sync local changes back to the broker
```

### Automated sync via GitHub Actions

The CLI ships a workflow template at
`packages/workbooks/packages/workbook-cli/templates/.github/workflows/workbooks-sync.yml`.
Copy it into a working-copy repo and set the `WORKBOOKS_BEARER` secret
to your CLI auth token, and the repo will:

- `push` (repo → broker) every time `.workbooks-group.json` or any
  `*.html` changes on `main`
- `pull` (broker → repo) every 15 minutes; commits any drift back

This is the "bidirectional GitHub sync" path that works today, no
broker-side integration needed.

### Broker-managed GitHub integration (future)

The dedicated Studio "Connect this group to GitHub" surface lives in
epic wb-97c. That version stores the repo link on the broker, uses
installation tokens (no per-user PATs in workflow files), and accepts
inbound pushes via webhook so the cycle is event-driven instead of
schedule-driven. Until that ships, the workflow template above
covers the same ground via GitHub Actions.
