// mcp.* — exercise the workbook tool-call surface from the eval. A
// published workbook can advertise tools (workbook.config.mjs > tools)
// and the broker round-trips invocations via /v1/workbooks/<id>/invoke.
// `workbook call` is the shell-side wrapper; we shell out to it the
// same way other primitives do, so the spec asserts against the same
// surface a user would script against.

import { spawn } from "node:child_process";

import { spawnArgsForWorkbook } from "../../util/workbook-bin.mjs";

export const mcpChecks = {
  /**
   * Invoke a tool on a published workbook and assert on the response.
   *
   *   - kind: mcp.call
   *     id: wb_abc123                       # optional: defaults to ctx.lastPublishedId
   *     tool: forecast_revenue              # required
   *     args: { q: 2, year: 2026 }          # optional JSON object
   *     expect:
   *       substring: "ok"                   # response stdout contains substring
   *       jsonField: result.status          # dotted path into parsed JSON …
   *       jsonValue: "ok"                   # … must equal this value
   *
   * `expect` can specify substring, jsonField+jsonValue, or both. Both
   * must hold when both are provided. At least one is required —
   * `mcp.call` without an expectation is shaped exactly like the
   * "session.text_contains DONE without a paired gate" anti-pattern
   * (USE PAIRED, EVAL_PRINCIPLES.md #6).
   */
  "mcp.call": async (ctx, params) => {
    const id = params?.id ?? ctx.lastPublishedId;
    if (!id || typeof id !== "string") {
      return { ok: false, message: `mcp.call: requires "id" (string) or a prior workbook.publish that set ctx.lastPublishedId` };
    }
    if (!params || typeof params.tool !== "string") {
      return { ok: false, message: `mcp.call: requires "tool" (string)` };
    }
    if (!params.expect || typeof params.expect !== "object") {
      return { ok: false, message: `mcp.call: requires "expect" (object with substring and/or jsonField+jsonValue)` };
    }
    const { substring, jsonField, jsonValue } = params.expect;
    if (substring == null && jsonField == null) {
      return { ok: false, message: `mcp.call: "expect" must specify at least "substring" or "jsonField"` };
    }
    if (jsonField != null && jsonValue === undefined) {
      return { ok: false, message: `mcp.call: "expect.jsonField" requires "expect.jsonValue"` };
    }

    const cmdArgs = ["call", id, params.tool];
    if (params.args && typeof params.args === "object") {
      cmdArgs.push("--json", JSON.stringify(params.args));
    }
    const res = await runCmd(cmdArgs);
    if (!res.ok) {
      return {
        ok: false,
        message: `mcp.call: workbook call exited ${res.code}`,
        detail: { stderr: res.stderr.slice(0, 400), stdout: res.stdout.slice(0, 400) },
      };
    }
    if (typeof substring === "string" && !res.stdout.includes(substring)) {
      return {
        ok: false,
        message: `mcp.call: substring ${JSON.stringify(substring)} not in response`,
        detail: { stdout: res.stdout.slice(0, 400) },
      };
    }
    if (typeof jsonField === "string") {
      let parsed;
      try { parsed = JSON.parse(res.stdout); }
      catch (err) {
        return {
          ok: false,
          message: `mcp.call: response is not JSON (jsonField check needs JSON)`,
          detail: { parseError: String(err.message ?? err), stdout: res.stdout.slice(0, 400) },
        };
      }
      const got = readDotted(parsed, jsonField);
      if (got !== jsonValue) {
        return {
          ok: false,
          message: `mcp.call: jsonField ${jsonField} ≠ expected`,
          detail: { expected: JSON.stringify(jsonValue), got: JSON.stringify(got) },
        };
      }
    }
    return { ok: true, message: `mcp.call ${params.tool} ok` };
  },
};

function readDotted(obj, dotted) {
  return dotted.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function runCmd(args) {
  return new Promise((resolve) => {
    const [spawnCmd, spawnArgs] = spawnArgsForWorkbook(args);
    const child = spawn(spawnCmd, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"], env: process.env,
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
