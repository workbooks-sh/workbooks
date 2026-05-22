// Eval-framework configuration. Reads workbook.local.json (gitignored)
// from the cwd, falling back to the WORKBOOKS_EVAL_ORG env var. The
// resolved org is what every substrate.* check clones against.
//
// Config shape:
//   { "eval": { "org": "workbooks-eval", "crossOrgTokenPath": "..." } }

import { promises as fs } from "node:fs";
import path from "node:path";

let cached = null;

export async function loadEvalConfig(cwd = process.cwd()) {
  if (cached) return cached;
  let fileCfg = {};
  try {
    const raw = await fs.readFile(path.join(cwd, "workbook.local.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.eval && typeof parsed.eval === "object") fileCfg = parsed.eval;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  cached = {
    org: process.env.WORKBOOKS_EVAL_ORG ?? fileCfg.org ?? null,
    foreignOrg: fileCfg.foreignOrg ?? null,
    crossOrgTokenPath: fileCfg.crossOrgTokenPath ?? null,
    readOnlyTokenPath: fileCfg.readOnlyTokenPath ?? null,
    expiredTokenPath: fileCfg.expiredTokenPath ?? null,
    broker: process.env.WORKBOOKS_BROKER ?? fileCfg.broker ?? "https://auth.workbooks.sh",
  };
  return cached;
}

export function requireEvalOrg(cfg) {
  if (!cfg.org) {
    throw new Error(
      "eval: no eval org configured. Set workbook.local.json -> eval.org " +
        "to a dedicated org slug (recommended: workbooks-eval) or export " +
        "WORKBOOKS_EVAL_ORG. Substrate checks will not run against your default org.",
    );
  }
  return cfg.org;
}
