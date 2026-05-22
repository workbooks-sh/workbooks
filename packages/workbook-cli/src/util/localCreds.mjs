// Load credentials from `workbook.local.json` for dev / private builds.
//
// Schema:
//   {
//     "databases": {
//       "main":  { "url": "https://xxx.supabase.co", "key": "eyJ..." },
//       "cache": { "url": "https://xxx.turso.io", "key": "..." }
//     }
//   }
//
// The file is intentionally NOT in workbook.config.mjs — it must never
// be checked into source control. Tooling assumes it's gitignored.
//
// Three contexts call this:
//   - `workbook dev` — always loads. Local creds are essential for the
//     dev loop and never leave the author's machine.
//   - `workbook build --embed-private` — loads, bakes creds into the
//     artifact. Use for self-use builds that travel between author's
//     own machines. Build emits a warning + the artifact emits a
//     console.warn at runtime.
//   - `workbook build --bake-public-db` — loads, validates that the
//     key looks anon-shaped (Supabase JWT with role:"anon" or empty),
//     bakes. Use for public-RLS demos. Build refuses to emit if the
//     key looks like a service-role secret.

import fs from "node:fs/promises";
import path from "node:path";

const FILENAME = "workbook.local.json";

/** Merge a {databases:{slot:{url,key}}} fragment into workbook.local.json,
 *  creating the file if absent. Existing slots are overwritten with the
 *  new entry; unrelated slots are preserved. */
export async function mergeLocalCreds(projectRoot, fragment) {
  const filePath = path.join(projectRoot, FILENAME);
  let parsed = {};
  try {
    const raw = await fs.readFile(filePath, "utf8");
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${FILENAME}: existing file is not a JSON object`);
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const databases = (parsed.databases && typeof parsed.databases === "object")
    ? parsed.databases
    : {};
  for (const [slot, entry] of Object.entries(fragment.databases ?? {})) {
    databases[slot] = { url: entry.url, key: entry.key };
  }
  parsed.databases = databases;
  await fs.writeFile(filePath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  return filePath;
}

export async function loadLocalCreds(projectRoot) {
  const filePath = path.join(projectRoot, FILENAME);
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${FILENAME}: invalid JSON — ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${FILENAME}: top-level must be an object`);
  }
  const databases = parsed.databases ?? {};
  if (typeof databases !== "object" || Array.isArray(databases)) {
    throw new Error(`${FILENAME}: 'databases' must be an object keyed by slot name`);
  }
  const out = {};
  for (const [slot, entry] of Object.entries(databases)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${FILENAME}: databases[${slot}] must be an object`);
    }
    if (typeof entry.url !== "string" || typeof entry.key !== "string") {
      throw new Error(`${FILENAME}: databases[${slot}] requires string 'url' and 'key'`);
    }
    out[slot] = { url: entry.url, key: entry.key };
  }
  return Object.keys(out).length === 0 ? null : { databases: out };
}

// Heuristic check that a Supabase JWT is the anon key, not the
// service-role key. JWT layout: header.payload.signature; payload is
// base64url-encoded JSON. Anon keys have role:"anon"; service-role
// keys have role:"service_role". A wrong-role key here is a leak waiting
// to happen — the whole point of --bake-public-db is RLS-safe demos.
//
// If the key isn't a JWT at all (or we can't parse it), we return
// "unknown" — caller decides what to do. Convex deploy keys, Turso
// tokens, and Postgres passwords all fall into this bucket.
export function classifySupabaseKey(key) {
  const parts = key.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadStr = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(payloadStr);
    if (payload?.role === "anon") return "anon";
    if (payload?.role === "service_role") return "service_role";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function validateBakeableCreds(databases, manifest) {
  const errors = [];
  const warnings = [];
  for (const [slot, creds] of Object.entries(databases)) {
    const decl = manifest.find((d) => d.name === slot);
    if (!decl) {
      warnings.push(`${slot}: no matching slot in workbook.config.mjs > databases (will be ignored)`);
      continue;
    }
    if (decl.kind === "supabase") {
      const cls = classifySupabaseKey(creds.key);
      if (cls === "service_role") {
        errors.push(
          `${slot} (supabase): key looks like a service-role JWT. Service-role keys bypass RLS — never bake one into an artifact you share. Use the anon key instead.`,
        );
      } else if (cls === "unknown") {
        warnings.push(
          `${slot} (supabase): key doesn't parse as a JWT. Double-check it's the anon key, not a deploy key or service password.`,
        );
      }
    }
  }
  return { errors, warnings };
}
