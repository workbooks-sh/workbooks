// SubstrateHandle — owns a tempdir clone of the eval org's substrate
// for the lifetime of one eval run. Lazy: nothing happens until the
// first substrate.* check or action requests `ensureClone()`.
//
// `refresh()` is called before every check so we observe the most
// recent push by the agent under test. `pushChange()` is used by
// cleanup actions to remove paths after the run.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { spawnArgsForWorkbook } from "../util/workbook-bin.mjs";

export class SubstrateHandle {
  constructor({ org }) {
    this.org = org;
    this.cloneDir = null;
  }

  async ensureClone() {
    if (this.cloneDir) return this.cloneDir;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wb-eval-${this.org}-`));
    // git-worker shallow clone support shipped (903fa7af1) but the
    // deployed version isn't serving the smart-HTTP `shallow` capability
    // for the default git protocol the workbook CLI uses. Verify the
    // deploy + protocol negotiation before re-enabling --depth 1 here.
    const [spawnCmd, spawnArgs] = spawnArgsForWorkbook(["git", "clone", this.org, dir]);
    await runCmd(spawnCmd, spawnArgs, {});
    this.cloneDir = dir;
    return dir;
  }

  async refresh() {
    const dir = await this.ensureClone();
    // wb-njoe — we used to short-circuit when this.refreshed was set
    // (just after ensureClone or after our own commitAndPush), to
    // skip a redundant network round-trip. But that's only safe when
    // we are the ONLY writer between two reads. In multi-actor specs
    // (eval framework setup writes a file, agent session pushes
    // another, eval reads back) the agent's push lands between our
    // push and our read — the short-circuit then makes us see a
    // stale local clone that doesn't have the agent's commit. Always
    // fetch; the network call is cheap and correctness > one RTT.
    await runCmd("git", ["fetch", "origin"], { cwd: dir });
    const branch = await defaultBranch(dir);
    await runCmd("git", ["reset", "--hard", `origin/${branch}`], { cwd: dir });
    // Drop untracked + gitignored files so the working tree mirrors
    // origin exactly. Without this, substrate.gitignored checks see
    // local untracked files (e.g. an agent's gitignored .env that
    // `git add -A` correctly skipped) and report them as "present in
    // the substrate" when in fact they were never pushed.
    await runCmd("git", ["clean", "-fdx"], { cwd: dir });
    return dir;
  }

  async readFile(relPath) {
    const dir = await this.refresh();
    const abs = safeJoin(dir, relPath);
    try {
      return await fs.readFile(abs);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async listTree(relPath, { recursive = true } = {}) {
    const dir = await this.refresh();
    const abs = safeJoin(dir, relPath);
    const out = [];
    await walkTree(abs, abs, out, recursive);
    out.sort();
    return out;
  }

  async isGitignored(relPath) {
    const dir = await this.refresh();
    // check-ignore returns 0 if ignored, 1 if not.
    const { code } = await runCmd("git", ["check-ignore", "-q", relPath], { cwd: dir, allowNonZero: true });
    return code === 0;
  }

  async removePath(relPath, { message } = {}) {
    await this.refresh();
    return this.commitAndPush(message ?? `eval: remove ${relPath}`, async (dir) => {
      // Re-apply on every attempt: the agent's sandbox may have pushed
      // the path back between our fetch and our push, so each retry
      // must rm again after `reset --hard origin/<branch>`.
      const abs = safeJoin(dir, relPath);
      await fs.rm(abs, { recursive: true, force: true });
    });
  }

  // Commits whatever is in the worktree and pushes. The optional
  // `reapply` callback is invoked once before the first commit and
  // again on each retry after a refresh, so callers can redo their
  // mutation against the freshly-reset tree.
  //
  // Race we defend against: the agent's sandbox (independent clone of
  // the same substrate) can push between our fetch and our push,
  // landing us with `[rejected] main -> main (fetch first)`. On
  // rejection we fetch + hard-reset to origin, re-apply, commit again,
  // push again. Cap at 3 attempts.
  async commitAndPush(message, reapply) {
    const dir = await this.ensureClone();
    const branch = await defaultBranch(dir);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (reapply) await reapply(dir);
      await runCmd("git", ["add", "-A"], { cwd: dir });
      const { stdout: porcelain } = await runCmd("git", ["status", "--porcelain"], { cwd: dir });
      if (!porcelain.trim()) return false;
      await runCmd("git", ["commit", "-m", message], { cwd: dir });
      const push = await runCmd("git", ["push", "origin", branch], { cwd: dir, allowNonZero: true });
      if (push.code === 0) {
        // wb-njoe — we used to set this.refreshed = true here so the
        // next refresh() would skip its network fetch under the
        // theory that "we just pushed, our local clone is the
        // latest." That breaks any spec where an INDEPENDENT actor
        // (e.g. an agent session) pushes between our commitAndPush
        // and the next check — refresh() would short-circuit and
        // miss the other actor's commit. Always re-fetch on read;
        // see refresh() for the full rationale.
        return true;
      }
      const stderr = `${push.stderr}\n${push.stdout}`.toLowerCase();
      const rejected = stderr.includes("rejected") || stderr.includes("fetch first") || stderr.includes("non-fast-forward");
      if (!rejected || attempt === maxAttempts) {
        throw new Error(`git push origin ${branch} exited ${push.code}: ${push.stderr.trim().slice(0, 300)}`);
      }
      // Remote moved under us. Drop our local commit, sync to origin,
      // and let the next loop iteration re-apply + re-commit.
      await runCmd("git", ["fetch", "origin"], { cwd: dir });
      await runCmd("git", ["reset", "--hard", `origin/${branch}`], { cwd: dir });
    }
    return true;
  }

  async dispose() {
    if (this.cloneDir) {
      await fs.rm(this.cloneDir, { recursive: true, force: true });
      this.cloneDir = null;
    }
  }
}

async function defaultBranch(dir) {
  // origin/HEAD resolves to e.g. "origin/main"; strip the prefix.
  try {
    const { stdout } = await runCmd("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: dir });
    const name = stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    if (name) return name;
  } catch { /* fall through */ }
  return "main";
}

function safeJoin(root, rel) {
  if (rel.includes("\0")) throw new Error(`eval: path contains null byte`);
  const joined = path.resolve(root, rel);
  if (!joined.startsWith(root + path.sep) && joined !== root) {
    throw new Error(`eval: path "${rel}" escapes substrate root`);
  }
  return joined;
}

async function walkTree(root, dir, out, recursive) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    if (e.name === ".git") continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full);
    if (e.isDirectory()) {
      if (recursive) await walkTree(root, full, out, recursive);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
}

function runCmd(cmd, args, { cwd, allowNonZero = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !allowNonZero) {
        reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr.trim().slice(0, 300)}`));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}
