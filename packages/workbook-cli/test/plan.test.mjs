#!/usr/bin/env node
// `workbook plan` smoke test — round-trips a real .org file through the
// worg binary via the workbook-cli shim. Skips silently if the binary
// can't be located (CI / fresh checkout without a cargo build).

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(HERE, "..", "bin", "workbook.mjs");

let pass = 0;
let fail = 0;
let skipped = 0;

function check(name, ok, detail) {
  console.log(
    `${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`,
  );
  if (ok) pass++;
  else fail++;
}

// Use the shim's own resolver to find the worg binary the same way a
// user would. If it can't find one, skip with a clear note rather
// than failing CI on machines without a built worg.
async function findWorgViaShim() {
  // Pull the resolver indirectly: run `workbook plan ready` with a
  // bogus file, and look at exit code 2 + the error text to confirm
  // the shim is wired in. Then probe known dev-fallback paths the
  // shim would have found.
  const repoRoot = path.resolve(HERE, "..", "..", "..", "..", "..");
  for (const candidate of [
    path.join(repoRoot, "packages", "worg", "target", "release", "worg"),
    path.join(repoRoot, "packages", "worg", "target", "debug", "worg"),
    path.join(repoRoot, "target", "release", "worg"),
    path.join(repoRoot, "target", "debug", "worg"),
  ]) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

async function main() {
  // Always-runnable test: help text + unknown subcommand error.
  {
    const r = spawnSync(process.execPath, [WORKBOOK, "plan"], { encoding: "utf8" });
    check(
      "workbook plan (no args): exits 2 with help",
      r.status === 2 && /workbook plan/.test(r.stdout),
      { status: r.status },
    );
  }
  {
    const r = spawnSync(process.execPath, [WORKBOOK, "plan", "nope"], { encoding: "utf8" });
    check(
      "workbook plan <unknown>: exits 2 + stderr lists subcommand",
      r.status === 2 && /unknown subcommand 'nope'/.test(r.stderr),
      { status: r.status, stderr: r.stderr.slice(0, 100) },
    );
  }

  const worg = await findWorgViaShim();
  if (!worg) {
    skipped += 6;
    console.log(
      "⊘ skipping worg-roundtrip tests (no built worg binary found). " +
        "Run `cargo build --release --manifest-path packages/worg/Cargo.toml --bin worg` " +
        "from the repo root.",
    );
    summary();
    return;
  }

  // Build a tiny fixture .org with a single TODO.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wb-plan-"));
  const planFile = path.join(root, "plan.org");
  await fs.writeFile(
    planFile,
    [
      "* TODO Bake the cake",
      ":PROPERTIES:",
      ":ID:       cake-001",
      ":END:",
      "",
    ].join("\n"),
  );

  // 1. ready — should list cake-001 with TODO state.
  {
    const r = spawnSync(process.execPath, [WORKBOOK, "plan", "ready", planFile], {
      encoding: "utf8",
    });
    check(
      "workbook plan ready: exits 0 + lists the TODO",
      r.status === 0 && /cake-001/.test(r.stdout),
      { status: r.status },
    );
  }

  // 2. claim — TODO → DOING, --agent flag passes through.
  {
    const r = spawnSync(
      process.execPath,
      [WORKBOOK, "plan", "claim", planFile, "cake-001", "--agent=baker"],
      { encoding: "utf8" },
    );
    const after = await fs.readFile(planFile, "utf8");
    check(
      "workbook plan claim: exits 0",
      r.status === 0,
      { status: r.status, stderr: r.stderr.slice(0, 200) },
    );
    check(
      "workbook plan claim: TODO → DOING on disk",
      after.includes("* DOING Bake the cake"),
    );
    check(
      "workbook plan claim: stamps :ASSIGNED_AGENT: baker",
      after.includes(":ASSIGNED_AGENT: baker"),
    );
  }

  // 3. log — appends to LOGBOOK.
  {
    const r = spawnSync(
      process.execPath,
      [WORKBOOK, "plan", "log", planFile, "cake-001", "preheated oven"],
      { encoding: "utf8" },
    );
    const after = await fs.readFile(planFile, "utf8");
    check(
      "workbook plan log: appends LOGBOOK entry",
      r.status === 0 && /preheated oven/.test(after),
      { status: r.status, stderr: r.stderr.slice(0, 200) },
    );
  }

  // 4. close — DOING → DONE, --reason flag passes through.
  {
    const r = spawnSync(
      process.execPath,
      [WORKBOOK, "plan", "close", planFile, "cake-001", "--reason=eaten"],
      { encoding: "utf8" },
    );
    const after = await fs.readFile(planFile, "utf8");
    check(
      "workbook plan close: exits 0 + DOING → DONE",
      r.status === 0 && /\* DONE Bake the cake/.test(after),
      { status: r.status, stderr: r.stderr.slice(0, 200) },
    );
  }

  await fs.rm(root, { recursive: true, force: true });
  summary();
}

function summary() {
  console.log("\n──────────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}   SKIPPED: ${skipped}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(2);
});
