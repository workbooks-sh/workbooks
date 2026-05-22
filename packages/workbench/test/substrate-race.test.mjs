#!/usr/bin/env node
// wb-f3jt — SubstrateHandle.commitAndPush retry-on-reject smoke.
//
// Simulates the race: two independent clones of the same bare repo,
// both attempt to push different changes. Without retry the second
// push gets [rejected]; with retry it should re-fetch, reset, re-apply
// the rm, and converge.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { SubstrateHandle } from "../src/eval/substrate.mjs";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !opts.allowNonZero) {
        reject(new Error(`${cmd} ${args.join(" ")} -> ${code}: ${stderr}`));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function setupBareRepo(root) {
  const bare = path.join(root, "remote.git");
  await fs.mkdir(bare, { recursive: true });
  await run("git", ["init", "--bare", "-b", "main"], { cwd: bare });

  // Seed it via a one-shot worktree clone.
  const seed = path.join(root, "seed");
  await fs.mkdir(seed, { recursive: true });
  await run("git", ["clone", bare, seed]);
  await run("git", ["-C", seed, "config", "user.email", "eval@test"]);
  await run("git", ["-C", seed, "config", "user.name", "eval"]);
  await fs.writeFile(path.join(seed, "README.md"), "seed\n");
  await fs.mkdir(path.join(seed, "agent-output"), { recursive: true });
  await fs.writeFile(path.join(seed, "agent-output", "spa.html"), "<html>spa</html>\n");
  await fs.writeFile(path.join(seed, "agent-output", "other.html"), "<html>other</html>\n");
  await run("git", ["-C", seed, "add", "-A"]);
  await run("git", ["-C", seed, "commit", "-m", "seed"]);
  await run("git", ["-C", seed, "push", "origin", "main"]);
  return bare;
}

async function manualClone(bare, dest) {
  await run("git", ["clone", bare, dest]);
  await run("git", ["-C", dest, "config", "user.email", "eval@test"]);
  await run("git", ["-C", dest, "config", "user.name", "eval"]);
  // Make sure origin/HEAD is set (matters for defaultBranch()).
  await run("git", ["-C", dest, "remote", "set-head", "origin", "main"]);
  return dest;
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-substrate-race-"));
  try {
    const bare = await setupBareRepo(tmp);

    // Clone A — driven by SubstrateHandle (our code under test).
    const cloneA = path.join(tmp, "A");
    await manualClone(bare, cloneA);
    const handle = new SubstrateHandle({ org: "test" });
    // Inject the clone directly — bypass the `workbook git clone` path
    // that would otherwise reach for the substrate Worker.
    handle.cloneDir = cloneA;
    handle.refreshed = true;

    // Clone B — the "agent sandbox" racing against us.
    const cloneB = path.join(tmp, "B");
    await manualClone(bare, cloneB);

    // 1. First removePath against the freshly-seeded substrate.
    //    Nothing racy yet — must succeed.
    const removed1 = await handle.removePath("agent-output/spa.html");
    assert.equal(removed1, true, "first removePath should commit + push");

    // 2. Simulate the race: B pushes a change AFTER our handle's last
    //    fetch but BEFORE our next push. We'll pre-stage B's push, then
    //    invoke removePath again — handle.refresh() will see the world
    //    up to that point, but if we sneak B's push in between
    //    refresh() and commitAndPush(), the first push attempt should
    //    be rejected and the retry should converge.
    //
    //    Easiest deterministic trigger: hold the handle stale, push
    //    from B, then call removePath (which refreshes, rm's,
    //    commits, pushes — and the race window is too small to
    //    reliably hit by timing). Instead: monkeypatch reapply to
    //    sneak in B's push right before the first commit. That puts
    //    us in the exact state the bug describes: our local main is
    //    one commit ahead of origin's HEAD-as-we-thought-it-was, but
    //    origin's HEAD has actually advanced by one too -> rejected
    //    on push, retry recovers.
    let racePushed = false;
    const realCommitAndPush = handle.commitAndPush.bind(handle);
    handle.commitAndPush = async (msg, reapply) => {
      return realCommitAndPush(msg, async (dir) => {
        if (reapply) await reapply(dir);
        if (!racePushed) {
          racePushed = true;
          // B is its own clone — must catch up to origin before
          // attempting its own push, exactly like the real agent
          // sandbox would.
          await run("git", ["-C", cloneB, "fetch", "origin"]);
          await run("git", ["-C", cloneB, "reset", "--hard", "origin/main"]);
          await fs.writeFile(path.join(cloneB, "agent-output", "race.html"), "race\n");
          await run("git", ["-C", cloneB, "add", "-A"]);
          await run("git", ["-C", cloneB, "commit", "-m", "race from B"]);
          await run("git", ["-C", cloneB, "push", "origin", "main"]);
        }
      });
    };

    // The actual test: remove other.html. Without retry this would
    // push, get rejected (B raced ahead), and throw.
    const removed2 = await handle.removePath("agent-output/other.html");
    assert.equal(removed2, true, "racing removePath should converge via retry");

    // 3. Verify the final remote state: spa.html and other.html are
    //    gone, race.html is present.
    const verify = path.join(tmp, "verify");
    await run("git", ["clone", bare, verify]);
    const files = await fs.readdir(path.join(verify, "agent-output"));
    assert.ok(!files.includes("spa.html"), "spa.html should be removed");
    assert.ok(!files.includes("other.html"), "other.html should be removed");
    assert.ok(files.includes("race.html"), "race.html should be present (from B)");

    console.log("OK substrate-race: commitAndPush converges through push rejection");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
