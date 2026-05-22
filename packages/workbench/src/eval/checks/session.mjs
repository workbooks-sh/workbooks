// Session-scoped checks. Operate over the flattened event log of a
// single turn (the events streamed back from `workbook chat --json`)
// plus, in the case of session.persisted_to_db, the broker's session
// export.

import { spawn } from "node:child_process";

import { spawnArgsForWorkbook } from "../../util/workbook-bin.mjs";

export const sessionChecks = {
  "session.text_contains": ({ events }, params) => {
    // `substring` accepts either a string (single needle) or an array
    // (any-of). Mirrors session.tool_called's any-of shape so specs
    // can tolerate small phrasing variance ("DONE" vs "Done." vs
    // "done") without inflating the prompt with case-strict commands.
    const wantList = Array.isArray(params?.substring)
      ? params.substring.filter((s) => typeof s === "string")
      : typeof params?.substring === "string"
        ? [params.substring]
        : null;
    if (!wantList || wantList.length === 0) {
      return fail(`session.text_contains: requires "substring" (string or string[])`);
    }
    const text = lastAssistantText(events);
    if (text == null) {
      return fail(`session.text_contains: no assistant message in turn`);
    }
    const hit = wantList.find((s) => text.includes(s));
    if (!hit) {
      return fail(
        `session.text_contains: none of ${JSON.stringify(wantList)} found`,
        { excerpt: text.slice(0, 200) },
      );
    }
    return pass();
  },

  "session.tool_called": ({ events }, params) => {
    // `name` accepts either a string (single tool) or an array (any-of).
    // Workhorse routinely picks `bash` (cat/echo) over the dedicated
    // `read`/`write` tools, so the any-of form lets specs assert
    // "the agent did SOME file op" without binding to a specific tool.
    const wantNames = Array.isArray(params?.name)
      ? params.name.filter((n) => typeof n === "string")
      : typeof params?.name === "string"
        ? [params.name]
        : null;
    if (!wantNames || wantNames.length === 0) {
      return fail(`session.tool_called: requires "name" (string or string[])`);
    }
    const wantSet = new Set(wantNames);
    const calls = events.filter(
      (e) => e.kind === "tool_start" && wantSet.has(e.payload?.toolName),
    );
    if (calls.length === 0) {
      const seen = [...new Set(events
        .filter((e) => e.kind === "tool_start")
        .map((e) => e.payload?.toolName)
        .filter(Boolean))];
      return fail(
        `session.tool_called: none of ${JSON.stringify(wantNames)} invoked`,
        { saw: seen.join(", ") || "(no tool calls)" },
      );
    }
    if (params.args && typeof params.args === "object") {
      const match = calls.find((c) => argsMatch(c.payload?.args, params.args));
      if (!match) {
        return fail(
          `session.tool_called: ${JSON.stringify(wantNames)} invoked but no call matched required args`,
          { wanted: JSON.stringify(params.args).slice(0, 200) },
        );
      }
    }
    return pass();
  },

  "session.persisted_to_db": async ({ sessionId }, params) => {
    if (!sessionId) {
      return fail(`session.persisted_to_db: no sessionId yet (called before any turn?)`);
    }
    const exported = await spawnWorkbookJson(["session", sessionId, "--format=json"]);
    if (!exported || typeof exported !== "object") {
      return fail(`session.persisted_to_db: broker returned no session bundle`);
    }
    const bundleId = exported.session?.id ?? exported.id ?? null;
    if (bundleId && bundleId !== sessionId) {
      return fail(`session.persisted_to_db: returned id ${bundleId} differs from ${sessionId}`);
    }
    if (typeof params?.minTurns === "number") {
      const turns = Array.isArray(exported.turns) ? exported.turns.length : 0;
      if (turns < params.minTurns) {
        return fail(`session.persisted_to_db: expected ≥${params.minTurns} turns in DB, got ${turns}`);
      }
    }
    return pass();
  },
};

// pi-agent-core emits MANY message_deltas per response, each with
// cumulative text — and a session has multiple responseIds (the model
// can produce several messages with tool calls interleaved). The
// "assistant text" the user sees is the MAX text per responseId,
// joined across responseIds in temporal order.
//
// Bug history: the original "last delta wins" extractor returned the
// 0-char STOP closer at the end of a response, missing the real text.
// That triggered false-positive silent_completion alarms and made our
// rubric checks fail on responses that actually had substance.
function lastAssistantText(events) {
  const byResponse = new Map(); // responseId → { firstTs, maxText }
  for (const e of events) {
    if (e.kind !== "message_delta") continue;
    const text = e.payload?.text;
    if (typeof text !== "string") continue;
    const rid = e.payload?.responseId ?? `delta-${e._id}`;
    const prev = byResponse.get(rid);
    if (!prev) {
      byResponse.set(rid, { firstTs: e.ts, maxText: text });
    } else if (text.length > prev.maxText.length) {
      prev.maxText = text;
    }
  }
  if (byResponse.size === 0) return null;
  const joined = [...byResponse.values()]
    .sort((a, b) => a.firstTs - b.firstTs)
    .map((r) => r.maxText)
    .filter((t) => t.length > 0)
    .join("\n\n");
  return joined.length > 0 ? joined : null;
}

function argsMatch(actual, expected) {
  if (actual == null) return false;
  for (const [k, v] of Object.entries(expected)) {
    const got = actual?.[k];
    if (typeof v === "string" && typeof got === "string") {
      if (!got.includes(v)) return false;
    } else if (JSON.stringify(got) !== JSON.stringify(v)) {
      return false;
    }
  }
  return true;
}

function spawnWorkbookJson(workbookArgs) {
  return new Promise((resolve, reject) => {
    const [spawnCmd, spawnArgs] = spawnArgsForWorkbook(workbookArgs);
    const child = spawn(spawnCmd, spawnArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`workbook ${workbookArgs[0] ?? ""} exited ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch (err) { reject(err); }
    });
  });
}

function pass() {
  return { ok: true };
}
function fail(message, detail) {
  return { ok: false, message, detail };
}
