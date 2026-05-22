// `workbook db <subcommand>` — provision and link databases to slots.
//
// Supports:
//   workbook db create <slot> --kind=turso
//     Provisions a fresh Turso DB using the platform token + org slug
//     from env (TURSO_PLATFORM_TOKEN, TURSO_ORG_SLUG) or flags. Mints
//     a per-DB auth token. Writes URL + token to workbook.local.json
//     so `workbook dev` picks it up immediately.
//
//   workbook db create <slot> --kind=supabase
//     Provisions a fresh Supabase project via the Management API.
//     Requires SUPABASE_ACCESS_TOKEN (personal token from supabase.com/
//     dashboard/account/tokens) and SUPABASE_ORG_ID. Polls until the
//     project reaches ACTIVE_HEALTHY (typically 60-120s), then fetches
//     the anon key.
//
//   workbook db create <slot> --kind=convex
//     Convex doesn't expose a public project-creation API — provisioning
//     happens interactively via `npx convex dev`. This subcommand links
//     an existing deployment: requires CONVEX_DEPLOY_URL (e.g.
//     https://thoughtful-rabbit-123.convex.cloud) and CONVEX_DEPLOY_KEY,
//     and writes them into workbook.local.json so the slot binds.
//
//   workbook db link <slot> --url <u> --key <k>
//     Link an arbitrary URL+key into the slot. Works for any kind.
//
//   workbook db list
//     Shows current per-slot bindings (workbook.local.json + declared).
//
// All `create` subcommands also accept --register --group <id> to push
// the new connection into a Studio group via the broker.

import { loadConfig } from "../util/config.mjs";
import { mergeLocalCreds } from "../util/localCreds.mjs";
import { ensureBearer, apiPost, DEFAULT_BROKER } from "../util/brokerClient.mjs";

const TURSO_API = "https://api.turso.tech";
const SUPABASE_API = "https://api.supabase.com";
const SUPABASE_DEFAULT_REGION = "us-east-1";
const SUPABASE_DEFAULT_PLAN = "free";
// Poll budget for Supabase project provisioning. Projects typically
// reach ACTIVE_HEALTHY in 30-120s; caps at 5 min so a stuck region
// doesn't hang the CLI forever.
const SUPABASE_POLL_INTERVAL_MS = 5_000;
const SUPABASE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export async function runDb(opts = {}) {
  const sub = opts._?.[0];
  if (!sub) {
    throw new Error(
      "workbook db: missing subcommand. Try `workbook db create <slot> --kind=turso`, `workbook db link <slot>`, or `workbook db list`.",
    );
  }
  if (sub === "create") return runCreate(opts);
  if (sub === "link") return runLink(opts);
  if (sub === "list") return runList(opts);
  throw new Error(
    `workbook db: unknown subcommand "${sub}". Supported: create, link, list.`,
  );
}

async function runCreate(opts) {
  const project = opts.project ?? ".";
  const slot = opts._?.[1];
  if (!slot) {
    throw new Error(
      "workbook db create: missing slot. Usage: workbook db create <slot> --kind=<turso|supabase|convex>",
    );
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(slot)) {
    throw new Error(
      `workbook db create: slot name ${JSON.stringify(slot)} must be snake_case [a-z][a-z0-9_]{0,63}`,
    );
  }

  const kind = opts.kind;
  if (kind !== "turso" && kind !== "supabase" && kind !== "convex") {
    throw new Error(
      "workbook db create: --kind must be one of turso, supabase, convex.",
    );
  }

  const config = await loadConfig(project);
  const declared = (config.databases ?? []).find((d) => d.name === slot);
  if (!declared) {
    throw new Error(
      `workbook db create: slot ${JSON.stringify(slot)} is not declared in workbook.config.mjs. ` +
        `Add it: databases: { ${slot}: { kind: "${kind}" } }`,
    );
  }
  if (declared.kind !== kind) {
    throw new Error(
      `workbook db create: workbook.config.mjs declares slot ${JSON.stringify(slot)} as ${declared.kind}, but --kind=${kind} was passed.`,
    );
  }

  let provisioned;
  if (kind === "turso") provisioned = await createTurso(opts, config, slot);
  else if (kind === "supabase") provisioned = await createSupabase(opts, config, slot);
  else if (kind === "convex") provisioned = await createConvex(opts, config, slot);

  const { url, key, label } = provisioned;
  const filePath = await mergeLocalCreds(config.root, {
    databases: { [slot]: { url, key } },
  });
  process.stdout.write(
    `[workbook db] ${label} → slot "${slot}"\n` +
      `  url:  ${url}\n` +
      `  key:  ${maskKey(key)} (saved to ${filePath})\n` +
      `  next: \`workbook dev\` will use this slot automatically.\n`,
  );

  if (opts.register) {
    const groupId = opts.group;
    if (!groupId) {
      throw new Error(
        "workbook db create --register also needs --group <groupId> (the broker group D1 id).",
      );
    }
    process.stdout.write(`[workbook db] registering into group ${groupId}…\n`);
    const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
    const result = await apiPost(
      `/v1/groups/${encodeURIComponent(groupId)}/database-connections`,
      { kind, baseUrl: url, apiKey: key },
      { bearer, broker: DEFAULT_BROKER },
    );
    if (result?.error) {
      throw new Error(
        `workbook db create --register failed: ${result.error}${result.detail ? ` — ${result.detail}` : ""}`,
      );
    }
    process.stdout.write(
      `[workbook db] registered ${kind} connection in group — other admins can see it in Studio → Groups → Settings → Databases.\n`,
    );
  }
}

async function createTurso(opts, config, slot) {
  const token = opts.token ?? process.env.TURSO_PLATFORM_TOKEN;
  const org = opts.org ?? process.env.TURSO_ORG_SLUG;
  if (!token) {
    throw new Error(
      "workbook db create --kind=turso: TURSO_PLATFORM_TOKEN is missing. Get a platform token at https://app.turso.tech/account/settings and export it, or pass --token.",
    );
  }
  if (!org) {
    throw new Error(
      "workbook db create --kind=turso: TURSO_ORG_SLUG is missing. Find it under your Turso account and export it, or pass --org.",
    );
  }

  const dbName = opts.name ?? derivedDbName(config.slug, slot);
  if (!/^[a-z0-9-]{1,32}$/.test(dbName)) {
    throw new Error(
      `workbook db create: derived db name ${JSON.stringify(dbName)} must match /^[a-z0-9-]{1,32}$/. Pass --name to override.`,
    );
  }

  const tursoGroup = opts["turso-group"] ?? "default";
  let hostname = await provisionTursoDb({ token, org, name: dbName, group: tursoGroup });
  if (hostname == null) {
    hostname = await fetchTursoHostname({ token, org, name: dbName });
  }
  const dbToken = await mintTursoToken({ token, org, name: dbName });
  return {
    url: `https://${hostname}`,
    key: dbToken,
    label: `created turso db "${dbName}"`,
  };
}

async function createSupabase(opts, config, slot) {
  const token = opts.token ?? process.env.SUPABASE_ACCESS_TOKEN;
  const orgId = opts.org ?? process.env.SUPABASE_ORG_ID;
  if (!token) {
    throw new Error(
      "workbook db create --kind=supabase: SUPABASE_ACCESS_TOKEN is missing. " +
        "Get a personal access token at https://supabase.com/dashboard/account/tokens and export it, or pass --token.",
    );
  }
  if (!orgId) {
    throw new Error(
      "workbook db create --kind=supabase: SUPABASE_ORG_ID is missing. " +
        "Find it in your Supabase dashboard URL (https://supabase.com/dashboard/org/<id>) and export it, or pass --org.",
    );
  }

  const projectName = opts.name ?? derivedProjectName(config.slug, slot);
  const region = opts.region ?? SUPABASE_DEFAULT_REGION;
  const plan = opts.plan ?? SUPABASE_DEFAULT_PLAN;
  // db_pass is required by the Management API but the workbook never
  // uses it (we go through PostgREST with the anon key, not direct
  // Postgres). Generate something strong, drop it on the floor.
  const dbPass = opts["db-password"] ?? randomDbPassword();

  process.stdout.write(
    `[workbook db] creating Supabase project "${projectName}" in ${region} (plan=${plan})…\n`,
  );
  const project = await provisionSupabaseProject({
    token,
    orgId,
    name: projectName,
    region,
    plan,
    dbPass,
  });

  process.stdout.write(
    `[workbook db] provisioning… (project id ${project.id}; polls every 5s, ~60-120s typical)\n`,
  );
  await waitForSupabaseReady({ token, projectRef: project.id });

  const anonKey = await fetchSupabaseAnonKey({ token, projectRef: project.id });
  const url = `https://${project.id}.supabase.co`;
  return {
    url,
    key: anonKey,
    label: `created supabase project "${projectName}" (${project.id})`,
  };
}

async function createConvex(opts, _config, _slot) {
  const deployUrl =
    opts.url ?? process.env.CONVEX_DEPLOY_URL ?? process.env.CONVEX_URL;
  const deployKey = opts.key ?? process.env.CONVEX_DEPLOY_KEY;
  if (!deployUrl) {
    throw new Error(
      "workbook db create --kind=convex: no Convex deploy URL.\n" +
        "Convex doesn't expose a public project-creation API — projects are created interactively via `npx convex dev`. After that:\n" +
        "  1. Find your deployment URL (https://<name>.convex.cloud) — it's in convex/.env.local as CONVEX_URL.\n" +
        "  2. Generate a deploy key at https://dashboard.convex.dev/team/<team>/project/<name>/settings.\n" +
        "  3. Re-run: workbook db create <slot> --kind=convex --url <deploy-url> --key <deploy-key>\n" +
        "OR export CONVEX_DEPLOY_URL + CONVEX_DEPLOY_KEY and rerun.",
    );
  }
  if (!deployKey) {
    throw new Error(
      "workbook db create --kind=convex: no Convex deploy key. " +
        "Generate one at https://dashboard.convex.dev and export CONVEX_DEPLOY_KEY, or pass --key.",
    );
  }
  if (!/^https?:\/\//.test(deployUrl)) {
    throw new Error(
      `workbook db create --kind=convex: deploy URL must be http(s):// — got ${JSON.stringify(deployUrl)}`,
    );
  }
  // Sanity-probe the deploy: GET /version is unauthenticated and
  // cheap. Catches typos before we write the local file.
  const probe = await fetch(`${deployUrl.replace(/\/+$/, "")}/version`).catch(
    () => null,
  );
  if (!probe || !probe.ok) {
    throw new Error(
      `workbook db create --kind=convex: GET ${deployUrl}/version failed (${probe?.status ?? "network error"}). Check the URL.`,
    );
  }
  return {
    url: deployUrl.replace(/\/+$/, ""),
    key: deployKey,
    label: "linked existing convex deployment",
  };
}

async function runLink(opts) {
  const project = opts.project ?? ".";
  const slot = opts._?.[1];
  if (!slot) {
    throw new Error(
      "workbook db link: missing slot. Usage: workbook db link <slot> --url=<u> --key=<k>",
    );
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(slot)) {
    throw new Error(
      `workbook db link: slot name ${JSON.stringify(slot)} must be snake_case [a-z][a-z0-9_]{0,63}`,
    );
  }
  const url = opts.url;
  const key = opts.key;
  if (typeof url !== "string" || url.length < 8) {
    throw new Error("workbook db link: --url is required.");
  }
  if (typeof key !== "string" || key.length < 4) {
    throw new Error("workbook db link: --key is required.");
  }

  const config = await loadConfig(project);
  const declared = (config.databases ?? []).find((d) => d.name === slot);
  if (!declared) {
    throw new Error(
      `workbook db link: slot ${JSON.stringify(slot)} is not declared in workbook.config.mjs. ` +
        `Add it first: databases: { ${slot}: { kind: "supabase" | "convex" | "turso" } }`,
    );
  }

  const filePath = await mergeLocalCreds(config.root, {
    databases: { [slot]: { url, key } },
  });
  process.stdout.write(
    `[workbook db] linked ${declared.kind} slot "${slot}"\n` +
      `  url: ${url}\n` +
      `  key: ${maskKey(key)} (saved to ${filePath})\n`,
  );

  if (opts.register) {
    const groupId = opts.group;
    if (!groupId) {
      throw new Error(
        "workbook db link --register also needs --group <groupId>.",
      );
    }
    process.stdout.write(`[workbook db] registering into group ${groupId}…\n`);
    const bearer = await ensureBearer({ broker: DEFAULT_BROKER });
    const result = await apiPost(
      `/v1/groups/${encodeURIComponent(groupId)}/database-connections`,
      { kind: declared.kind, baseUrl: url, apiKey: key },
      { bearer, broker: DEFAULT_BROKER },
    );
    if (result?.error) {
      throw new Error(
        `workbook db link --register failed: ${result.error}${result.detail ? ` — ${result.detail}` : ""}`,
      );
    }
    process.stdout.write(
      `[workbook db] registered ${declared.kind} connection in group.\n`,
    );
  }
}

async function runList(opts) {
  const project = opts.project ?? ".";
  const config = await loadConfig(project);
  const declared = config.databases ?? [];
  if (declared.length === 0) {
    process.stdout.write(
      "[workbook db] no databases declared in workbook.config.mjs.\n",
    );
    return;
  }
  const { loadLocalCreds } = await import("../util/localCreds.mjs");
  const local = await loadLocalCreds(config.root);
  const localMap = local?.databases ?? {};

  const rows = declared.map((d) => {
    const localEntry = localMap[d.name];
    if (localEntry) {
      return {
        name: d.name,
        kind: d.kind,
        source: "local",
        url: localEntry.url,
        key: maskKey(localEntry.key),
      };
    }
    return { name: d.name, kind: d.kind, source: "—", url: "", key: "" };
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }

  const widths = {
    slot: Math.max(4, ...rows.map((r) => r.name.length)),
    kind: Math.max(4, ...rows.map((r) => r.kind.length)),
    source: Math.max(6, ...rows.map((r) => r.source.length)),
    url: Math.max(3, ...rows.map((r) => r.url.length)),
  };
  const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
  process.stdout.write(
    `${pad("slot", widths.slot)}  ${pad("kind", widths.kind)}  ${pad("source", widths.source)}  ${pad("url", widths.url)}  key\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `${pad(r.name, widths.slot)}  ${pad(r.kind, widths.kind)}  ${pad(r.source, widths.source)}  ${pad(r.url, widths.url)}  ${r.key}\n`,
    );
  }
  if (rows.some((r) => r.source === "—")) {
    process.stdout.write(
      `\nSlots with source="—" have no local credentials. Studio resolves them ` +
        `at runtime from the group's pinned connection, or prompts the recipient ` +
        `via the first-run config panel.\n`,
    );
  }
}

function derivedDbName(slug, slot) {
  const base = `${slug}-${slot}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const collapsed = base.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return collapsed.length > 32 ? collapsed.slice(0, 32).replace(/-$/, "") : collapsed;
}

async function provisionTursoDb({ token, org, name, group }) {
  const res = await fetch(`${TURSO_API}/v1/organizations/${encodeURIComponent(org)}/databases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, group }),
  });
  if (res.status === 409) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`workbook db create: Turso API ${res.status} on create — ${body}`);
  }
  const body = await res.json();
  const hostname = body?.database?.Hostname ?? body?.database?.hostname;
  if (!hostname) {
    throw new Error(
      `workbook db create: Turso API responded without a Hostname field — body: ${JSON.stringify(body)}`,
    );
  }
  return hostname;
}

async function fetchTursoHostname({ token, org, name }) {
  const res = await fetch(
    `${TURSO_API}/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`workbook db create: Turso API ${res.status} on lookup — ${body}`);
  }
  const body = await res.json();
  const hostname = body?.database?.Hostname ?? body?.database?.hostname;
  if (!hostname) {
    throw new Error(
      `workbook db create: Turso API lookup missing Hostname — body: ${JSON.stringify(body)}`,
    );
  }
  return hostname;
}

async function mintTursoToken({ token, org, name }) {
  const res = await fetch(
    `${TURSO_API}/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(name)}/auth/tokens`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `workbook db create: Turso API ${res.status} on token mint — ${body}`,
    );
  }
  const body = await res.json();
  const jwt = body?.jwt;
  if (typeof jwt !== "string" || jwt.length < 10) {
    throw new Error(
      `workbook db create: Turso API responded without a jwt field — body: ${JSON.stringify(body)}`,
    );
  }
  return jwt;
}

// ── Supabase Management API ───────────────────────────────────────
// Docs: https://supabase.com/docs/reference/api/introduction
// Project creation returns immediately with a project ref + status =
// COMING_UP. The project goes through INIT_DB_FAILED|COMING_UP|
// ACTIVE_HEALTHY|... — we poll until ACTIVE_HEALTHY before fetching
// the anon key (the keys endpoint 404s during early provisioning).

async function provisionSupabaseProject({ token, orgId, name, region, plan, dbPass }) {
  const res = await fetch(`${SUPABASE_API}/v1/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      organization_id: orgId,
      region,
      plan,
      db_pass: dbPass,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `workbook db create --kind=supabase: Management API ${res.status} on create — ${body}`,
    );
  }
  const body = await res.json();
  const projectRef = body?.id ?? body?.ref;
  if (!projectRef) {
    throw new Error(
      `workbook db create --kind=supabase: Management API response missing project id/ref — body: ${JSON.stringify(body)}`,
    );
  }
  return { id: projectRef };
}

async function waitForSupabaseReady({ token, projectRef }) {
  const deadline = Date.now() + SUPABASE_POLL_TIMEOUT_MS;
  let lastStatus = "(unknown)";
  while (Date.now() < deadline) {
    const res = await fetch(`${SUPABASE_API}/v1/projects/${projectRef}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const body = await res.json();
      const status = body?.status ?? "(missing)";
      lastStatus = status;
      if (status === "ACTIVE_HEALTHY") return;
      // Failure terminal states — fail fast rather than poll uselessly.
      if (
        status === "INIT_FAILED" ||
        status === "RESTORE_FAILED" ||
        status === "UPGRADE_FAILED" ||
        status === "PAUSE_FAILED"
      ) {
        throw new Error(
          `workbook db create --kind=supabase: project ${projectRef} entered failure state ${status}. ` +
            `Check the dashboard at https://supabase.com/dashboard/project/${projectRef}.`,
        );
      }
    }
    await new Promise((r) => setTimeout(r, SUPABASE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `workbook db create --kind=supabase: project ${projectRef} not ACTIVE_HEALTHY after ${SUPABASE_POLL_TIMEOUT_MS / 1000}s (last status: ${lastStatus}). ` +
      `Check https://supabase.com/dashboard/project/${projectRef}.`,
  );
}

async function fetchSupabaseAnonKey({ token, projectRef }) {
  const res = await fetch(`${SUPABASE_API}/v1/projects/${projectRef}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `workbook db create --kind=supabase: Management API ${res.status} on api-keys — ${body}`,
    );
  }
  const body = await res.json();
  if (!Array.isArray(body)) {
    throw new Error(
      `workbook db create --kind=supabase: api-keys response not an array — body: ${JSON.stringify(body)}`,
    );
  }
  const anon = body.find((row) => row?.name === "anon");
  if (!anon?.api_key) {
    throw new Error(
      `workbook db create --kind=supabase: no anon key in api-keys response — names: ${body.map((r) => r?.name).join(", ")}`,
    );
  }
  return anon.api_key;
}

function derivedProjectName(slug, slot) {
  // Supabase project names: 1-100 chars, mostly free-form. Keep
  // the same shape as our slug-slot derivation.
  return `${slug}-${slot}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 100);
}

function randomDbPassword() {
  // 32 char base64url. We never use this password — it's a Management
  // API requirement, not something the workbook touches. The
  // user can rotate it in the dashboard if they actually need direct
  // Postgres access.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
