// workbook.* — post-turn actions that exercise the workbook build
// pipeline against the substrate clone. Without these, an "agent
// produced a workbook" check can only verify the source tree exists;
// it can't say whether the artifact actually builds or renders.
//
// puppeteer is an optional dep of workbook-cli — the renderProbe
// gracefully degrades when it's missing (artifact-presence check only).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { spawnArgsForWorkbook } from "../../util/workbook-bin.mjs";

// EVAL_PRINCIPLES.md #6 audit (wb-xpgr.4.4) — a bare `workbook.build`
// check passes as long as ANY .html lands in dist/. An agent shipping
// `<html></html>` would pass. Defaults below let us require at least
// one shape-appropriate DOM marker without forcing every spec author
// to spell it out. Authors who deliberately want artifact-presence
// only must set `probe: false`.
const DEFAULT_PROBE_BY_TYPE = {
  spa: ['script[type="module"]'],
  agent: ['script[type="module"]'],
  presentation: ["[data-slide], section.slide, .slide"],
  document: ["h1, h2, article"],
  notebook: ["wb-cell, [data-cell], .wb-cell"],
};

export const workbookActions = {
  /**
   * Publish an already-built workbook artifact to workbooks.sh. Spawns
   * `workbook publish <html>` and captures the public id from stdout.
   * Surface:
   *
   *   - kind: workbook.publish
   *     workbookPath: workbooks/<slug>     # required: substrate-relative project dir
   *     artifact: dist/<slug>.html         # optional: relative to workbookPath
   *
   * On success: sets ctx.lastPublishedId, ctx.lastPublishedUrl so
   * subsequent actions / checks can address the same artifact.
   *
   * NOTE: this writes to public state at workbooks.sh — there is no
   * automatic cleanup. The spec author is responsible for `workbook
   * publish --revoke <id>` in `cleanup:` if they want to tidy up.
   */
  "workbook.publish": async (ctx, params) => {
    if (!params || typeof params.workbookPath !== "string") {
      throw new Error(`workbook.publish: requires "workbookPath" (string)`);
    }
    const cloneRoot = await ctx.substrate.ensureClone();
    // Deliberately NOT calling ctx.substrate.refresh() here.
    //
    // refresh() runs `git clean -fdx` (to drop untracked + gitignored
    // files so substrate.gitignored checks see only what was actually
    // pushed). But a preceding workbook.build action creates dist/ as
    // an untracked build artifact in the same clone. A refresh between
    // build and publish wipes that dist/ and publish fails with
    // 'no dist/ to publish — build first', even though build just
    // succeeded. The two actions are designed to chain — publish
    // consumes what build just produced — so we trust the clone state
    // here without re-syncing from origin.
    const wbDir = path.resolve(cloneRoot, params.workbookPath);
    if (!wbDir.startsWith(cloneRoot + path.sep)) {
      throw new Error(`workbook.publish: ${params.workbookPath} escapes substrate root`);
    }
    let artifactPath;
    if (params.artifact) {
      artifactPath = path.resolve(wbDir, params.artifact);
      try { await fs.stat(artifactPath); }
      catch { return { ok: false, message: `workbook.publish: artifact ${params.artifact} not found` }; }
    } else {
      const distDir = path.resolve(wbDir, "dist");
      let entries;
      try { entries = await fs.readdir(distDir); }
      catch {
        return { ok: false, message: `workbook.publish: no dist/ to publish — build first` };
      }
      const htmls = entries.filter((e) => e.endsWith(".html"));
      if (htmls.length === 0) {
        return { ok: false, message: `workbook.publish: no .html in dist/` };
      }
      artifactPath = path.join(distDir, htmls[0]);
    }
    const res = await runWorkbookCmd(wbDir, ["publish", artifactPath]);
    if (!res.ok) {
      return {
        ok: false,
        message: `workbook.publish: publish failed`,
        detail: { stderr: res.stderr.slice(0, 400), stdout: res.stdout.slice(0, 400) },
      };
    }
    // stdout shape from src/commands/publish.mjs:
    //   "\n  <viewerBase>/w/<id>\n\n  revoke: workbook publish --revoke <id>\n  …"
    // Extract id from the revoke line first (most reliable); fall back to /w/<id>.
    const id = extractPublishedId(res.stdout);
    if (!id) {
      return {
        ok: false,
        message: `workbook.publish: could not parse id from publish output`,
        detail: { stdout: res.stdout.slice(0, 400) },
      };
    }
    const urlMatch = res.stdout.match(/(https?:\/\/[^\s]+\/w\/[^\s]+)/);
    ctx.lastPublishedId = id;
    if (urlMatch) ctx.lastPublishedUrl = urlMatch[1];
    return {
      ok: true,
      message: `published ${id}${urlMatch ? ` (${urlMatch[1]})` : ""}`,
      lastPublishedId: id,
    };
  },

  /**
   * Pull a previously-published workbook artifact into a tempdir, so
   * later checks can compare the round-tripped source bundle against
   * what was originally published. Surface:
   *
   *   - kind: workbook.pull
   *     id: wb_abc123                # optional: defaults to ctx.lastPublishedId
   *     slug: my-slug                # required when no source workbook in substrate
   *
   * Writes a minimal workbook.config.mjs into a tempdir, then spawns
   * `workbook pull --id <id> --force` from that tempdir. Sets
   * ctx.lastPulledDir on success.
   */
  "workbook.pull": async (ctx, params) => {
    const id = params?.id ?? ctx.lastPublishedId;
    if (!id || typeof id !== "string") {
      return {
        ok: false,
        message: `workbook.pull: requires "id" (string) or a prior workbook.publish that set ctx.lastPublishedId`,
      };
    }
    const slug = typeof params?.slug === "string" ? params.slug : "pulled";
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wb-eval-pull-"));
    // Minimal scaffolding so loadConfig() at the project root succeeds.
    // `entry` must point at a real file, so we stub one too.
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "src", "index.html"),
      "<!doctype html><html><body></body></html>\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmpRoot, "workbook.config.mjs"),
      `export default { name: ${JSON.stringify(slug)}, slug: ${JSON.stringify(slug)}, type: "spa", entry: "src/index.html" };\n`,
      "utf8",
    );
    const res = await runWorkbookCmd(tmpRoot, ["pull", "--id", id, "--force"]);
    if (!res.ok) {
      return {
        ok: false,
        message: `workbook.pull: pull failed`,
        detail: { stderr: res.stderr.slice(0, 400), stdout: res.stdout.slice(0, 400) },
      };
    }
    ctx.lastPulledDir = tmpRoot;
    return { ok: true, message: `pulled ${id} → ${tmpRoot}`, lastPulledDir: tmpRoot };
  },

  /**
   * Run `workbook build` inside the eval's substrate clone, then
   * optionally probe the rendered artifact for runtime errors / DOM
   * markers. Surfaces:
   *
   *   - kind: workbook.build
   *     workbookPath: workbooks/<slug>            # required, relative to substrate
   *     expectDist: dist/<slug>.html              # default: dist/<slug>.html
   *     probe:
   *       noConsoleErrors: true                   # default true
   *       domSelectors: [ "form input" ]          # all must match
   *       maxWaitMs: 5000
   */
  "workbook.build": async (ctx, params) => {
    if (!params || typeof params.workbookPath !== "string") {
      throw new Error(`workbook.build: requires "workbookPath" (string)`);
    }
    const cloneRoot = await ctx.substrate.ensureClone();
    await ctx.substrate.refresh();
    const wbDir = path.resolve(cloneRoot, params.workbookPath);
    if (!wbDir.startsWith(cloneRoot + path.sep)) {
      throw new Error(`workbook.build: ${params.workbookPath} escapes substrate root`);
    }
    let stat;
    try { stat = await fs.stat(wbDir); }
    catch { return { ok: false, message: `workbook.build: ${params.workbookPath} not in substrate` }; }
    if (!stat.isDirectory()) {
      return { ok: false, message: `workbook.build: ${params.workbookPath} is not a directory` };
    }

    const buildRes = await runWorkbookBuild(wbDir);
    if (!buildRes.ok) {
      return { ok: false, message: `workbook.build: build failed`, detail: { stderr: buildRes.stderr.slice(0, 400) } };
    }

    // Locate the dist artifact. When expectDist is pinned we honor it;
    // otherwise scan dist/ for any .html — the agent picks the slug,
    // which may not match the directory name.
    let distPath;
    if (params.expectDist) {
      distPath = path.resolve(wbDir, params.expectDist);
      try { await fs.stat(distPath); }
      catch {
        return { ok: false, message: `workbook.build: artifact ${params.expectDist} not found after build` };
      }
    } else {
      const distDir = path.resolve(wbDir, "dist");
      let entries;
      try { entries = await fs.readdir(distDir); }
      catch {
        return { ok: false, message: `workbook.build: no dist/ directory after build` };
      }
      const htmls = entries.filter((e) => e.endsWith(".html"));
      if (htmls.length === 0) {
        return { ok: false, message: `workbook.build: no .html in dist/`, detail: { dist: entries.join(", ") } };
      }
      distPath = path.join(distDir, htmls[0]);
    }

    // Explicit `probe: false` opts out of all post-build verification.
    // Otherwise we always probe: when the spec omits `probe`, fall back
    // to a shape-appropriate default keyed off workbook.config.mjs's
    // `type` field. See DEFAULT_PROBE_BY_TYPE above.
    if (params.probe === false) {
      return { ok: true, message: `built ${path.relative(wbDir, distPath)}` };
    }
    let probeConfig = params.probe;
    if (!probeConfig) {
      const inferred = await inferDefaultProbe(wbDir);
      if (!inferred.ok) {
        return { ok: false, message: inferred.message, detail: inferred.detail };
      }
      probeConfig = inferred.probe;
    }

    const probeRes = await renderProbe(distPath, probeConfig);
    return probeRes.ok
      ? { ok: true, message: `built + probed ${path.relative(wbDir, distPath)}` }
      : { ok: false, message: probeRes.message, detail: probeRes.detail };
  },
};

async function inferDefaultProbe(wbDir) {
  const cfgPath = path.join(wbDir, "workbook.config.mjs");
  let cfg;
  try {
    const mod = await import(pathToFileURL(cfgPath).href + `?t=${Date.now()}`);
    cfg = mod.default ?? mod;
  } catch (err) {
    return {
      ok: false,
      message: `workbook.build: cannot read workbook.config.mjs to infer probe (set probe explicitly or "probe: false" to skip)`,
      detail: { error: String(err.message ?? err) },
    };
  }
  const type = typeof cfg?.type === "string" ? cfg.type : "spa";
  const selectors = DEFAULT_PROBE_BY_TYPE[type];
  if (!selectors) {
    return {
      ok: false,
      message: `workbook.build: no default probe for type="${type}" (set probe explicitly or "probe: false" to skip)`,
    };
  }
  return { ok: true, probe: { domSelectors: selectors, noConsoleErrors: true } };
}

function runWorkbookBuild(cwd) {
  return runWorkbookCmd(cwd, ["build"]);
}

function runWorkbookCmd(cwd, args) {
  return new Promise((resolve) => {
    const [spawnCmd, spawnArgs] = spawnArgsForWorkbook(args);
    const child = spawn(spawnCmd, spawnArgs, {
      cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env,
    });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
    child.on("error", (err) => resolve({ ok: false, code: -1, stdout, stderr: stderr + String(err) }));
  });
}

function extractPublishedId(stdout) {
  // First-line shape (workbooks):
  //   "  <viewer>/w/<id>"
  // Followed later by:
  //   "  revoke: workbook publish --revoke <id>"
  // Agent shape:
  //   "published agent <slug> → <studioUrl>\n  id: <id>\n"
  const revokeMatch = stdout.match(/--revoke\s+(\S+)/);
  if (revokeMatch) return revokeMatch[1];
  const wMatch = stdout.match(/\/w\/([A-Za-z0-9_-]+)/);
  if (wMatch) return wMatch[1];
  const idLineMatch = stdout.match(/^\s*id:\s*(\S+)/m);
  if (idLineMatch) return idLineMatch[1];
  return null;
}

async function renderProbe(distPath, probeConfig) {
  let puppeteer;
  try { puppeteer = (await import("puppeteer")).default; }
  catch {
    return { ok: true, message: "(render probe skipped — puppeteer not installed)" };
  }
  const noConsoleErrors = probeConfig.noConsoleErrors !== false;
  const selectors = Array.isArray(probeConfig.domSelectors) ? probeConfig.domSelectors : [];
  const maxWaitMs = typeof probeConfig.maxWaitMs === "number" ? probeConfig.maxWaitMs : 5000;

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => { consoleErrors.push(err.message); });
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    await page.goto(`file://${distPath}`, { waitUntil: "networkidle2", timeout: maxWaitMs });
    if (noConsoleErrors && consoleErrors.length > 0) {
      return { ok: false, message: "console errors during render", detail: { errors: consoleErrors.slice(0, 3).join(" | ") } };
    }
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (!el) {
        return { ok: false, message: `selector "${sel}" not present in rendered artifact` };
      }
    }
    return { ok: true };
  } finally {
    await browser.close().catch(() => {});
  }
}
