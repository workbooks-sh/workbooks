// `workbook publish <file.html> [--revoke <id>]` — upload a compiled
// workbook to workbooks.sh and print a public share URL.
//
// Flow:
//   1. Load cached bearer from ~/.config/workbooks/auth.json. If
//      missing or expired, run loopback OAuth: start a temporary
//      HTTP server on 127.0.0.1:<random>, open the user's browser
//      at auth.workbooks.sh/v1/auth/start?return_to=<our-port>,
//      catch the broker_code on the redirect, exchange it for a
//      bearer at /v1/auth/exchange. Cache the bearer.
//   2. POST /v1/workbooks/public {slug,title} → {id, share_url}.
//   3. PUT  /v1/workbooks/:id/artifact (raw HTML body).
//   4. Print share_url + revoke instructions.

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { readBundleMeta } from "../bundle/embedSource.mjs";
import { loadConfig } from "../util/config.mjs";
import { buildToolsWorker } from "../util/buildToolsWorker.mjs";
import { renderAuthCallbackPage } from "../util/authCallbackPage.mjs";

const DEFAULT_BROKER = process.env.WORKBOOKS_BROKER ?? "https://auth.workbooks.sh";
const DEFAULT_VIEWER = process.env.WORKBOOKS_VIEWER ?? "https://workbooks.sh";
const AUTH_PATH = path.join(os.homedir(), ".config", "workbooks", "auth.json");

export async function runPublish(opts = {}) {
  // --revoke <id> short-circuits — no upload, just hits the revoke
  // endpoint on the broker.
  if (opts.revoke) {
    const bearer = await ensureBearer({ broker: DEFAULT_BROKER, force: opts["force-auth"] });
    await revokeWorkbook({ broker: DEFAULT_BROKER, bearer, id: opts.revoke });
    process.stdout.write(`workbook revoked: ${opts.revoke}\n`);
    return;
  }

  const inputPath = opts._?.[0] ?? opts.input;
  if (!inputPath) {
    throw new Error(
      "workbook publish: missing input file.\n" +
        "  workbook publish <file.html>\n" +
        "  workbook publish --revoke <id>",
    );
  }
  const inputAbs = path.resolve(inputPath);
  const html = await fs.readFile(inputAbs, "utf8");
  if (html.length > 25 * 1024 * 1024) {
    throw new Error(
      `workbook publish: file is ${(html.length / 1024 / 1024).toFixed(1)} MB. ` +
        `The hosted viewer caps artifacts at 25 MB. Consider --no-bundle on build.`,
    );
  }

  // Derive a slug from the filename — `dist/my-thing.html` → `my-thing`.
  // If the source bundle exposes a rootName, prefer that.
  const meta = readBundleMeta(html);
  const slugFromBytes =
    meta?.rootName ?? path.basename(inputAbs, path.extname(inputAbs));

  // Try to load workbook.config.mjs so the publish picks up author +
  // description + title. Common layouts:
  //   - user is in project root, file is at dist/foo.html → cwd works
  //   - user passes an absolute path to a built .html elsewhere →
  //     try parent of file's parent (project root next to dist/)
  // If neither has a config, fall back to byte-derived values —
  // publishing a one-off built .html still works, just without identity.
  let cfg = null;
  const cwd = process.cwd();
  cfg = await loadConfig(cwd).catch(() => null);
  if (!cfg) {
    const projectGuess = path.dirname(path.dirname(inputAbs));
    cfg = await loadConfig(projectGuess).catch(() => null);
  }

  const slug = opts.slug ?? cfg?.slug ?? slugFromBytes;
  const title = opts.title ?? cfg?.name ?? slug;
  const author = opts.author ?? cfg?.author ?? null;
  const description = opts.description ?? cfg?.description ?? null;

  const bearer = await ensureBearer({
    broker: DEFAULT_BROKER,
    force: opts["force-auth"],
  });

  // Register the workbook record. The broker mints the id so the
  // CLI doesn't have to coordinate uniqueness.
  // The `connect:` block declares the workbook's routing policy
  // (which env-var name maps to which destination + splice rule).
  // The broker stores this on the workbook record and reads it at
  // proxy time — admin sets values, author sets policy.
  const connect = cfg?.connect && Object.keys(cfg.connect).length > 0 ? cfg.connect : undefined;

  // `--group <id>` publishes the workbook into a group library; only
  // members can view it on the hosted viewer. Without it, the workbook
  // is personal (public to anyone with the link).
  const group_id = opts.group ?? null;

  // Workbook type from manifest (spa | notebook | document). Used by
  // group view filtering / kanban grouping.
  const type = cfg?.type ?? null;

  // `--tag <slug>` (repeatable). Tags categorize the workbook within
  // the group library. Slashes are allowed for folder-style finders.
  const rawTags = Array.isArray(opts.tag)
    ? opts.tag
    : opts.tag != null
      ? [opts.tag]
      : [];
  const tags = rawTags
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length > 0);

  // Tools declared in workbook.config.mjs > tools: {} — same shape as
  // the manifest emits. The broker stores these so search results can
  // surface "this workbook exposes a `forecast` tool" without having
  // to re-parse the artifact.
  const tools = Array.isArray(cfg?.tools) && cfg.tools.length > 0 ? cfg.tools : undefined;

  // `--strip-git` removes the .git/ tree from the embedded source
  // bundle the public artifact ships with. Author's local checkout
  // stays untouched; this only changes what recipients unbundle.
  const strip_git = opts["strip-git"] === true;

  // Agent workbooks go to a different broker surface — they're
  // registered as agents (visible in Studio's /chat agent picker)
  // rather than as workbooks (visible in the library).
  if (type === "agent") {
    if (!cfg?.agent) {
      throw new Error(
        "workbook publish: type:'agent' but config has no agent block (build first with `workbook build`)",
      );
    }
    const createdAgent = await postJson(
      `${DEFAULT_BROKER}/v1/agents`,
      {
        slug,
        title,
        tagline: cfg.agent.tagline ?? null,
        description,
        group_ids: opts.group ? [opts.group] : [],
        manifest: {
          version: 1,
          provider: cfg.agent.provider ?? "openrouter",
          model: cfg.agent.model,
          systemPrompt: cfg.agent.systemPrompt,
          icon: cfg.agent.icon,
          tools: cfg.agent.tools,
          extensions: cfg.agent.extensions,
          components: cfg.agent.components ? Object.keys(cfg.agent.components) : [],
          skills: cfg.agent.skills ? Object.keys(cfg.agent.skills) : [],
          permissions: cfg.agent.permissions,
          defaultEnv: cfg.agent.defaultEnv,
        },
      },
      bearer,
    );
    if (!createdAgent.id) {
      throw new Error(
        `workbook publish: broker returned no agent id (${JSON.stringify(createdAgent)})`,
      );
    }
    await putBytes(
      `${DEFAULT_BROKER}/v1/agents/${encodeURIComponent(createdAgent.id)}/artifact`,
      html,
      bearer,
    );
    const studioUrl =
      createdAgent.studio_url ??
      `${DEFAULT_VIEWER.replace("workbooks.sh", "studio.workbooks.sh")}/chat?agent=${encodeURIComponent(slug)}`;
    process.stdout.write(
      `published agent ${slug} → ${studioUrl}\n` +
        `  id: ${createdAgent.id}\n`,
    );
    return;
  }

  const created = await postJson(
    `${DEFAULT_BROKER}/v1/workbooks/public`,
    { slug, title, author, description, connect, group_id, type, tags, tools, strip_git },
    bearer,
  );
  if (!created.id) {
    throw new Error(`workbook publish: broker returned no id (${JSON.stringify(created)})`);
  }

  // Upload the artifact bytes. The broker stores them in R2 and
  // serves them at workbooks.sh/w/<id> as a plain envelope.
  await putBytes(
    `${DEFAULT_BROKER}/v1/workbooks/${encodeURIComponent(created.id)}/artifact`,
    html,
    bearer,
  );

  // If the workbook declared any worker-runtime tools, compile their
  // handlers into one ES module and upload to the broker's WFP
  // dispatch path. Best-effort — never block the publish on this,
  // surface failures so the author can fix without re-running the
  // whole pipeline.
  if (cfg && Object.keys(cfg._toolHandlers ?? {}).length > 0) {
    try {
      const built = await buildToolsWorker(cfg);
      if (built) {
        await putJson(
          `${DEFAULT_BROKER}/v1/workbooks/${encodeURIComponent(created.id)}/tools-script`,
          { source: built.source },
          bearer,
        );
        process.stdout.write(
          `  tools (${built.tools.length}) → uploaded to dispatch namespace\n`,
        );
      }
    } catch (e) {
      process.stderr.write(
        `  tools upload failed: ${e?.message ?? e}\n` +
          `  (the workbook is published; tools won't dispatch until you re-publish)\n`,
      );
    }
  }

  // Database-slot pre-flight: if the workbook declares any DB slots
  // and is being published into a group, check whether the group has a
  // pinned connection for each kind. Unmapped kinds become recipient-
  // facing setup friction at runtime, so we surface them now while the
  // author is still at the terminal.
  await maybeWarnAboutUnmappedDatabases({ html, group_id, bearer });

  const shareUrl = created.share_url ?? `${DEFAULT_VIEWER}/w/${created.id}`;
  process.stdout.write(
    `\n  ${shareUrl}\n\n` +
      `  revoke: workbook publish --revoke ${created.id}\n` +
      `  or visit: https://studio.workbooks.sh/workbooks/${created.id}\n\n`,
  );
}

async function maybeWarnAboutUnmappedDatabases({ html, group_id, bearer }) {
  if (!group_id) return;
  // wb-databases is hoisted out of the compression sandwich (see
  // compress.mjs extractHeadEssentials), so a plain regex on the head
  // is enough — no need to decompress.
  const match = html.match(
    /<script[^>]*\bid\s*=\s*["']?wb-databases["']?[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return;
  let declared;
  try {
    declared = JSON.parse(match[1]);
  } catch {
    return;
  }
  if (!Array.isArray(declared) || declared.length === 0) return;
  const declaredKinds = new Set(
    declared
      .map((d) => (d && typeof d.kind === "string" ? d.kind : null))
      .filter(Boolean),
  );
  if (declaredKinds.size === 0) return;

  let pinned;
  try {
    const r = await fetch(
      `${DEFAULT_BROKER}/v1/groups/${encodeURIComponent(group_id)}/database-connections`,
      { headers: { authorization: `Bearer ${bearer}` } },
    );
    if (!r.ok) return;
    const data = await r.json();
    pinned = new Set(Array.isArray(data?.kinds) ? data.kinds : []);
  } catch {
    return;
  }
  const missing = [...declaredKinds].filter((k) => !pinned.has(k));
  if (missing.length === 0) return;

  const missingList = missing.map((k) => `    - ${k}`).join("\n");
  process.stderr.write(
    `\n  ⚠ this workbook declares database slot(s) the group has not wired:\n` +
      `${missingList}\n` +
      `  recipients will see the first-run config panel. wire them at\n` +
      `  https://studio.workbooks.sh/groups/${group_id}/settings\n` +
      `  or run \`workbook db create <slot> --kind=<kind> --register --group ${group_id}\`\n`,
  );
}

// ─────────────────────────────────────────────────────────────────
// Bearer cache.
// ─────────────────────────────────────────────────────────────────

export async function ensureBearer({ broker, force }) {
  // Sandbox / CI path: a pre-minted bearer flows in via env. This is
  // how agent runners and CI publishers authenticate — there is no
  // browser to run loopback OAuth, and ~/.config/workbooks/ doesn't
  // exist. When WORKBOOKS_BEARER is set, use it directly and skip
  // the cache + OAuth flow entirely. Honored even when `force` is
  // true because force is meant to re-auth interactively; if you set
  // a bearer in env, that IS your auth choice.
  if (typeof process.env.WORKBOOKS_BEARER === "string" && process.env.WORKBOOKS_BEARER.length > 0) {
    return process.env.WORKBOOKS_BEARER;
  }
  if (!force) {
    const cached = await readBearer();
    if (cached && cached.expires_at > Date.now() + 60_000) {
      return cached.bearer;
    }
  }
  /* Headless sandbox guard. Loopback OAuth needs a browser + a user;
   * in a sandbox (E2B, Daytona, Vercel, CI) there's neither, and the
   * default code waits 5 min before timing out — a brutal failure
   * mode. Detect headlessness via the same signals other CLIs use
   * and fail fast with an actionable message.
   *
   * Signals: no TTY on stdin/stdout, or any of the well-known
   * "I'm inside automation" env vars set by sandboxes/CI. */
  const isHeadless =
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.env.CI === "true" ||
    typeof process.env.SANDBOX === "string" ||
    typeof process.env.E2B_SANDBOX_ID === "string" ||
    typeof process.env.DAYTONA_WORKSPACE_ID === "string" ||
    typeof process.env.VERCEL_SANDBOX === "string" ||
    typeof process.env.WORKBOOKS_BROKER === "string";
  if (isHeadless) {
    process.stderr.write(
      "workbook publish: no WORKBOOKS_BEARER in env and no browser available for OAuth.\n" +
        "  This sandbox / CI runner needs a pre-minted capability:\n" +
        "    export WORKBOOKS_BEARER=<jwt>     # from the broker's /v1/internal/mint-capability\n" +
        "    export WORKBOOKS_BROKER=" +
        broker +
        "\n" +
        "  Agent sessions get this automatically from the runner. If you're seeing this in\n" +
        "  an agent session, WORKBOOKS_BROKER_URL is likely unset on the Convex deployment.\n",
    );
    process.exit(2);
  }
  const fresh = await loopbackAuth(broker);
  await writeBearer(fresh);
  return fresh.bearer;
}

async function readBearer() {
  try {
    const raw = await fs.readFile(AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.bearer === "string" && typeof parsed.expires_at === "number") {
      // Normalize expires_at: broker emits Unix seconds, but Date.now()
      // is ms. Without this normalization the freshness check below
      // (cached.expires_at > Date.now() + 60_000) always fails for a
      // valid token because seconds < ms by 1000x. Detect by magnitude:
      // anything < ~year 2033 in milliseconds (2e12) is almost
      // certainly seconds. Promote in-place so callers see ms.
      if (parsed.expires_at < 2_000_000_000) {
        parsed.expires_at = parsed.expires_at * 1000;
      }
      return parsed;
    }
  } catch {
    /* missing / malformed — caller will re-auth */
  }
  return null;
}

async function writeBearer(payload) {
  await fs.mkdir(path.dirname(AUTH_PATH), { recursive: true });
  await fs.writeFile(AUTH_PATH, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
}

// ─────────────────────────────────────────────────────────────────
// Loopback OAuth.
//
// 1. Start an HTTP listener on 127.0.0.1:<auto>.
// 2. Open the broker's /v1/auth/start with return_to pointing at us.
// 3. The broker runs WorkOS OIDC, then redirects to our listener
//    with ?broker_code=<code>.
// 4. We POST /v1/auth/exchange to swap the code for a bearer.
// ─────────────────────────────────────────────────────────────────

async function loopbackAuth(broker) {
  const { server, port, codePromise } = await startLoopbackListener();
  const startUrl = `${broker}/v1/auth/start?return_to=${encodeURIComponent(`http://127.0.0.1:${port}/cb`)}`;

  process.stdout.write(`Opening browser to sign in...\n  ${startUrl}\n`);
  openInBrowser(startUrl);

  let code;
  try {
    code = await codePromise;
  } finally {
    server.close();
  }

  const exchanged = await postJson(`${broker}/v1/auth/exchange`, { broker_code: code });
  if (!exchanged.bearer || !exchanged.expires_at) {
    throw new Error(`workbook publish: broker exchange failed (${JSON.stringify(exchanged)})`);
  }
  return {
    bearer: exchanged.bearer,
    // Broker reports seconds since epoch; we cache in ms for parity with Date.now().
    expires_at: exchanged.expires_at * 1000,
    sub: exchanged.sub,
    email: exchanged.email,
  };
}

function startLoopbackListener() {
  return new Promise((resolve, reject) => {
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    // 5-minute window — if the user wanders off, fail cleanly rather
    // than leaking the port forever.
    const deadline = setTimeout(() => rejectCode(new Error("auth timed out after 5m")), 5 * 60_000);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1`);
      if (url.pathname !== "/cb") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("broker_code");
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(
          renderAuthCallbackPage({
            status: "error",
            title: "Sign-in failed",
            message: "Workbooks could not complete CLI authentication.",
            detail: err,
          }),
        );
        clearTimeout(deadline);
        rejectCode(new Error(`broker error: ${err}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(
          renderAuthCallbackPage({
            status: "error",
            title: "Sign-in incomplete",
            message: "This callback did not include a sign-in code.",
            detail: "Return to your terminal and run the command again.",
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
        renderAuthCallbackPage({
          status: "success",
          title: "You're signed in",
          message: "The Workbooks CLI is authenticated.",
          detail: "You can close this tab and return to your terminal.",
        }),
      );
      clearTimeout(deadline);
      resolveCode(code);
    });

    server.on("error", reject);
    // Port 0 = let the OS pick a free port in the ephemeral range.
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, codePromise });
    });
  });
}

function openInBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" :
    platform === "win32"  ? "cmd"  :
    "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Headless / no browser — caller already printed the URL.
  }
}

// ─────────────────────────────────────────────────────────────────
// HTTP helpers.
// ─────────────────────────────────────────────────────────────────

async function postJson(url, body, bearer) {
  const headers = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`POST ${url} → ${r.status}: ${text.slice(0, 500)}`);
  }
  return r.json();
}

async function putBytes(url, body, bearer) {
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "text/html",
      authorization: `Bearer ${bearer}`,
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`PUT ${url} → ${r.status}: ${text.slice(0, 500)}`);
  }
}

async function putJson(url, body, bearer) {
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`PUT ${url} → ${r.status}: ${text.slice(0, 500)}`);
  }
  return r.json();
}

async function revokeWorkbook({ broker, bearer, id }) {
  const r = await fetch(`${broker}/v1/workbooks/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}` },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`revoke → ${r.status}: ${text.slice(0, 500)}`);
  }
}
