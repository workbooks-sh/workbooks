// auth.* — HTTP-level boundary tests against the broker. These
// checks DO NOT depend on session state; they live inside a
// check-only turn (a turn with no prompt).
//
// `auth.http_expect` is the generic primitive: fires one request
// with the selected token source and asserts the response status.
//
// URL + token-source strings support `{eval.X}` placeholders that
// resolve against the eval config in src/eval/config.mjs.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { loadEvalConfig } from "../config.mjs";

const AUTH_FILE = path.join(os.homedir(), ".config", "workbooks", "auth.json");

export const authChecks = {
  "auth.http_expect": async (_ctx, params) => {
    if (!params || typeof params.url !== "string") {
      return fail(`auth.http_expect: requires "url" (string)`);
    }
    if (typeof params.expectStatus !== "number") {
      return fail(`auth.http_expect: requires "expectStatus" (number)`);
    }
    const cfg = await loadEvalConfig();
    const url = await interpolate(params.url, cfg);
    if (url == null) {
      return skip(`auth.http_expect: url references unset config (${params.url})`);
    }
    let token;
    try {
      token = await resolveToken(params.tokenSource ?? "bearer", cfg);
    } catch (err) {
      return skip(`auth.http_expect: ${err.message}`);
    }
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      method: params.method ?? "GET",
      headers,
      body: params.body ?? undefined,
    });
    if (res.status !== params.expectStatus) {
      return fail(
        `auth.http_expect: ${params.method ?? "GET"} ${url} → ${res.status}, expected ${params.expectStatus}`,
      );
    }
    return pass();
  },
};

async function interpolate(template, cfg) {
  // Replace `{eval.X}` tokens with cfg.X. If any referenced key is
  // unset, return null (caller treats as skip).
  let unset = false;
  const out = template.replace(/\{eval\.([a-zA-Z0-9_]+)\}/g, (_, k) => {
    const v = cfg[k];
    if (v == null || v === "") { unset = true; return ""; }
    return String(v);
  });
  return unset ? null : out;
}

async function resolveToken(source, cfg) {
  if (source === "none") return null;
  if (source === "bearer") {
    const raw = await fs.readFile(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const bearer = parsed.token ?? parsed.bearer ?? parsed.access_token;
    if (!bearer) throw new Error("no bearer in ~/.config/workbooks/auth.json (run `workbook publish` to authenticate)");
    return bearer;
  }
  if (typeof source === "string" && source.startsWith("file:")) {
    const p = source.slice("file:".length);
    const raw = await fs.readFile(p, "utf8");
    const first = raw.split(/\r?\n/, 1)[0].trim();
    if (!first) throw new Error(`token file ${p} is empty`);
    return first;
  }
  if (source === "expired" || source === "readonly" || source === "crossorg") {
    const key = source === "expired" ? "expiredTokenPath"
              : source === "readonly" ? "readOnlyTokenPath"
              : "crossOrgTokenPath";
    const p = cfg[key];
    if (!p) throw new Error(`tokenSource "${source}" requires ${key} in eval config`);
    return resolveToken(`file:${p}`, cfg);
  }
  throw new Error(`unknown tokenSource: ${source}`);
}

function pass() { return { ok: true }; }
function fail(message, detail) { return { ok: false, message, detail }; }
// "skip" is a soft-pass: surfaces a message but doesn't fail the eval.
// Useful for environment-dependent checks (e.g. no foreign org configured).
function skip(message) { return { ok: true, skipped: true, message }; }
