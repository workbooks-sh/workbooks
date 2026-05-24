// `workbook plan` — mutation subcommands for .org plan files.
//
// Thin Node shim over the Rust `worg` CLI binary. Per the 2026-05-24
// handoff (docs/research/handoff-2026-05-24/wb-4vhr.md):
//
//   * Mutations (PART 1) shell out to the worg binary, which already
//     ships every subcommand we need (`ready`, `claim`, `transition`,
//     `log`, `result`, `close`) with atomic temp+rename writes and
//     round-trip-tested semantics. Sidesteps the WASM packaging
//     question entirely.
//
//   * Parse-at-build (PART 2) loads the worg WASM bindings directly
//     since the build is already in Node — no need to spawn a process
//     per file.
//
// Resolves the worg binary via, in order:
//   1. WORKBOOK_WORG_BIN env var (explicit override; supports CI / pinned)
//   2. `worg` on PATH (the normal case after `cargo install`)
//   3. The monorepo `target/release/worg` (dev convenience)
//
// All flags pass through verbatim; `workbook plan` is a thin wrapper,
// not a re-implementation.
//
// Exit codes mirror the worg binary (0 success, 1 error, 2 CLI usage).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUBCOMMANDS = ["ready", "claim", "transition", "log", "result", "close"];

const HELP = [
  "workbook plan — mutate .org task files via the worg binary",
  "",
  "Subcommands:",
  "  workbook plan ready <file> [--agent=<slug>]",
  "       list pickable (TODO/NEXT) tasks; optional :ASSIGNED_AGENT: filter",
  "  workbook plan claim <file> <id> [--agent=<slug>]",
  "       transition <id> to DOING, stamp :ASSIGNED_AGENT:",
  "  workbook plan transition <file> <id> <state>",
  "       set the TODO keyword (TODO/NEXT/WAITING/DOING/SOMEDAY/DONE/CANCELED/FAILED)",
  "  workbook plan log <file> <id> <entry>",
  "       append a `- <entry>` line to :LOGBOOK:",
  "  workbook plan result <file> <id> <content>",
  "       write a #+RESULTS: block under the task's first source block",
  "  workbook plan close <file> <id> [--reason=<text>]",
  "       transition to DONE, optionally documenting why",
  "",
  "Environment:",
  "  WORKBOOK_WORG_BIN   explicit path to the worg binary (overrides search)",
].join("\n");

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runPlan(flags = {}) {
  const positional = flags._ ?? [];
  const sub = positional[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(HELP + "\n");
    if (!sub) process.exit(2);
    return;
  }

  if (!SUBCOMMANDS.includes(sub)) {
    process.stderr.write(`workbook plan: unknown subcommand '${sub}'\n\n`);
    process.stdout.write(HELP + "\n");
    process.exit(2);
  }

  const worg = resolveWorgBin();
  if (!worg) {
    process.stderr.write(
      "workbook plan: cannot find the `worg` binary.\n" +
        "  Install: cargo install --path packages/worg/crates/worg-cli\n" +
        "  Or set WORKBOOK_WORG_BIN to an explicit path.\n"
    );
    process.exit(2);
  }

  const argv = buildArgv(sub, positional.slice(1), flags);

  const { status, error } = spawnSync(worg, argv, { stdio: "inherit" });
  if (error) {
    process.stderr.write(`workbook plan: ${error.message}\n`);
    process.exit(1);
  }
  process.exit(status ?? 1);
}

// Mirror the worg CLI's positional + flag layout. Each subcommand
// gets its file + id + extras in the same order as the Rust side
// (see packages/worg/crates/worg-cli/src/main.rs).
function buildArgv(sub, rest, flags) {
  const out = [sub, ...rest];
  if (sub === "ready" || sub === "claim") {
    if (flags.agent) out.push(`--agent=${flags.agent}`);
  }
  if (sub === "close") {
    if (flags.reason) out.push(`--reason=${flags.reason}`);
  }
  return out;
}

function resolveWorgBin() {
  if (process.env.WORKBOOK_WORG_BIN) {
    const p = process.env.WORKBOOK_WORG_BIN;
    if (isExecutable(p)) return p;
  }

  const onPath = lookOnPath("worg");
  if (onPath) return onPath;

  // Dev fallback: monorepo build output. workbook-cli lives at
  // packages/workbooks/packages/workbook-cli/src/commands — climb to
  // the repo root (six levels) and look for the worg workspace's
  // target dir (and the repo-root target as a secondary, in case
  // someone builds from the top level).
  const repoRoot = path.resolve(HERE, "..", "..", "..", "..", "..", "..");
  for (const candidate of [
    path.join(repoRoot, "packages", "worg", "target", "release", "worg"),
    path.join(repoRoot, "packages", "worg", "target", "debug", "worg"),
    path.join(repoRoot, "target", "release", "worg"),
    path.join(repoRoot, "target", "debug", "worg"),
  ]) {
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

function lookOnPath(name) {
  const PATH = process.env.PATH || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE").split(";")
      : [""];
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (isExecutable(p)) return p;
    }
  }
  return null;
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
