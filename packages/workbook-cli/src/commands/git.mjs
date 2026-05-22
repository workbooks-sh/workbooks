// `workbook git <subcommand>`
//
//   workbook git url [--org <org>]      print the substrate clone URL
//   workbook git credential-helper      git credential helper protocol
//   workbook git setup                  one-time gitconfig install
//   workbook git clone [<org>] [<dir>]  clone the org's substrate repo
//
// The substrate is the workbooks-internal git server (wb-acx2). After
// running `workbook git setup` once, plain `git clone /git push` calls
// against https://auth.workbooks.sh/git/<org>/<repo>.git work natively
// — git asks our credential helper for a fresh bearer; the helper
// reads it from the same ~/.config/workbooks/auth.json `workbook
// publish` already uses; the substrate validates the bearer (broker-
// minted capability JWT, git.read/git.write scopes).
//
// Once a user is set up, the workflow is identical to GitHub: clone,
// edit in your IDE of choice, commit, push. The workbooks brand
// disappears as plumbing.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_BROKER =
  process.env.WORKBOOKS_BROKER ?? "https://auth.workbooks.sh";
const AUTH_PATH = path.join(os.homedir(), ".config", "workbooks", "auth.json");

export async function runGit(opts = {}) {
  const sub = opts._?.[0];
  switch (sub) {
    case "url":
      await runUrl(opts);
      break;
    case "credential-helper":
      await runCredentialHelper(opts);
      break;
    case "setup":
      await runSetup(opts);
      break;
    case "clone":
      await runClone(opts);
      break;
    case undefined:
    case "help":
    case "--help":
      printUsage();
      break;
    default:
      process.stderr.write(`workbook git: unknown subcommand "${sub}"\n\n`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  process.stderr.write(
    [
      "workbook git — substrate git operations",
      "",
      "  workbook git url [--org <org>]",
      "    Print the substrate clone URL for an org. Defaults to the",
      "    signed-in user's personal namespace.",
      "",
      "  workbook git credential-helper",
      "    Git credential-helper. Called by git itself after `setup`.",
      "    Reads request from stdin, writes username=...\\npassword=...",
      "    on stdout. Pulls the bearer from the cli's auth cache; does",
      "    NOT trigger interactive OAuth (use `workbook publish` or any",
      "    interactive command to refresh first if the cache is stale).",
      "",
      "  workbook git setup",
      "    One-time configure git globally so plain `git clone` / `git",
      "    push` against the substrate Just Works. After this:",
      "      git clone https://auth.workbooks.sh/git/<org>/<repo>.git",
      "",
      "  workbook git clone [<org>] [<dir>]",
      "    Convenience wrapper: configures git on first run, then",
      "    clones the org's main repo. Useful for code-centric users",
      "    who want one command to start working in their IDE.",
      "",
    ].join("\n"),
  );
}

async function resolveOrg(explicit) {
  if (explicit) return explicit;
  try {
    const raw = await fs.readFile(AUTH_PATH, "utf8");
    const auth = JSON.parse(raw);
    if (auth.organization_id) return auth.organization_id;
    if (auth.sub) return `personal:${auth.sub}`;
  } catch {
    /* fall through to error below */
  }
  throw new Error(
    "Couldn't determine org. Pass --org <org>, or run `workbook publish` once to sign in.",
  );
}

async function runUrl(opts) {
  const org = await resolveOrg(opts.org);
  const url = substrateUrl(org);
  process.stdout.write(url + "\n");
}

function substrateUrl(org) {
  // Path segments are not encoded here — git will encode at the wire
  // layer, and the substrate's path parser percent-decodes. Keeping
  // the URL human-readable is the point of having stable URLs at all.
  return `${DEFAULT_BROKER}/git/${org}/main.git`;
}

// Git credential helper protocol. Git invokes us non-interactively
// during clone/fetch/push with the action ("get", "store", "erase")
// as the FIRST positional. The helper reads key=value lines from
// stdin until a blank line, then writes back its response.
//
// We only handle "get". "store" and "erase" are no-ops because the
// real token cache lives at ~/.config/workbooks/auth.json and is
// managed by the cli's auth commands.
async function runCredentialHelper(opts) {
  const action = opts._?.[1] ?? "get";
  if (action !== "get") return;

  const input = await readStdin();
  const fields = parseHelperLines(input);

  // Scope check: only respond when git is asking for credentials for
  // the broker host we recognize. If the request is for github.com
  // or some other host, return nothing — git will move on to the
  // next configured helper (or fail).
  const expectHost = new URL(DEFAULT_BROKER).host;
  if (fields.host && fields.host !== expectHost) return;
  if (fields.protocol && fields.protocol !== "https") return;

  // The cached auth.json bearer is a user-session token (used for
  // /v1/agents/chat, /v1/users/me etc.). The substrate worker
  // only accepts git-scoped capability JWTs signed with the
  // GIT_SUBSTRATE_SIGNING_KEY. Exchange the user session for a
  // short-lived git cap via /v1/users/me/git-capability before
  // handing it to git.
  const userBearer = await readAuthCacheNoninteractive();
  if (!userBearer) return;

  // wb-kven — extract the org from git's requested path so the broker
  // mints a cap scoped to that org instead of the session default.
  const targetOrg = parseOrgFromPath(fields.path);
  const gitCap = await mintGitCapability(userBearer, targetOrg);
  if (!gitCap) return;

  process.stdout.write(`username=x\npassword=${gitCap}\n`);
}

function parseOrgFromPath(p) {
  if (!p) return null;
  const parts = p.replace(/^\//, "").split("/");
  if (parts[0] !== "git" || !parts[1]) return null;
  return parts[1];
}

async function mintGitCapability(userBearer, targetOrg) {
  try {
    const res = await fetch(`${DEFAULT_BROKER}/v1/users/me/git-capability`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${userBearer}`,
      },
      body: JSON.stringify(targetOrg ? { org: targetOrg } : {}),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (typeof j.token === "string" && j.token.length > 0) return j.token;
  } catch {
    /* network / parse failure — return null, git will surface 401 */
  }
  return null;
}

function parseHelperLines(input) {
  const out = {};
  for (const line of input.split("\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

// Read the cached bearer without triggering OAuth. Normalizes the
// expires_at unit — the broker emits seconds, the cli historically
// expected ms; tolerate both so the cache works regardless.
async function readAuthCacheNoninteractive() {
  if (process.env.WORKBOOKS_BEARER && process.env.WORKBOOKS_BEARER.length > 0) {
    return process.env.WORKBOOKS_BEARER;
  }
  try {
    const raw = await fs.readFile(AUTH_PATH, "utf8");
    const auth = JSON.parse(raw);
    if (typeof auth.bearer !== "string") return null;
    const exp = typeof auth.expires_at === "number" ? auth.expires_at : 0;
    // If expires_at looks like seconds (under year 2033 when measured
    // in ms), promote to ms before comparing.
    const expMs = exp < 2_000_000_000 ? exp * 1000 : exp;
    if (expMs > Date.now() + 60_000) return auth.bearer;
  } catch {
    /* missing / malformed cache — return null and stay quiet */
  }
  return null;
}

async function runSetup(_opts) {
  // The bin entry point of the cli, so the helper config can reference
  // it unambiguously. process.argv[1] is the actual script path even
  // when invoked via the `workbook` symlink.
  const cliBin = process.argv[1];
  const brokerHttps = `https://${new URL(DEFAULT_BROKER).host}`;
  const helperValue = `!"${cliBin}" git credential-helper`;
  // Empty first to clear inherited helpers (e.g. macOS osxkeychain),
  // then ours. Without this, git consults the keychain first; cached
  // entries from prior clones get reused for new orgs and fail 403.
  await execGit([
    "config",
    "--global",
    "--replace-all",
    `credential.${brokerHttps}.helper`,
    "",
  ]);
  await execGit([
    "config",
    "--global",
    "--add",
    `credential.${brokerHttps}.helper`,
    helperValue,
  ]);
  // wb-kven — the helper extracts the target org from the requested
  // path. Git suppresses the path field by default; we need it to
  // mint org-scoped caps for multi-group users.
  await execGit([
    "config",
    "--global",
    `credential.${brokerHttps}.useHttpPath`,
    "true",
  ]);
  process.stderr.write(
    `✓ configured git credential helper for ${brokerHttps}\n` +
      `  git config --global credential.${brokerHttps}.helper '${helperValue}'\n` +
      `\n` +
      `  Try:\n` +
      `    workbook git clone\n` +
      `  or directly:\n` +
      `    git clone ${brokerHttps}/git/<org>/<repo>.git\n`,
  );
}

function execGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: "inherit" });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`git exit ${code}`)),
    );
    child.on("error", reject);
  });
}

async function runClone(opts) {
  // `workbook git clone <org> <dir> [--depth N]` — both positional, both optional.
  const orgArg = opts._?.[1];
  const dirArg = opts._?.[2];
  const org = orgArg ?? (await resolveOrg(opts.org));
  const url = substrateUrl(org);
  const dest = dirArg ?? defaultCloneDir(org);

  const depthArgs = opts.depth ? ["--depth", String(opts.depth)] : [];
  process.stderr.write(
    `Cloning ${url}${opts.depth ? ` (depth=${opts.depth})` : ""}\n          → ${dest}\n`,
  );
  await execGit(["clone", ...depthArgs, url, dest]);
}

function defaultCloneDir(org) {
  // Sanitize colons and slashes so the local dir name is shell-friendly.
  return `./${org.replace(/[:/]/g, "-")}-workbooks`;
}
