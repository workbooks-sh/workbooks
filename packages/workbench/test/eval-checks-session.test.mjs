#!/usr/bin/env node
// session.* check kinds — focuses on the any-of shape for both
// session.text_contains (string | string[]) and session.tool_called
// (string | string[]), since those two are what xsurface specs lean on
// to tolerate workhorse phrasing/tool-selection variance.

import { sessionChecks } from "../src/eval/checks/session.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++; else fail++;
}

function deltaEvent({ rid = "r1", ts = 1, text }) {
  return { kind: "message_delta", ts, payload: { responseId: rid, text } };
}
function toolStart({ name, args, ts = 1 }) {
  return { kind: "tool_start", ts, payload: { toolName: name, args } };
}

// session.text_contains
{
  const r = sessionChecks["session.text_contains"](
    { events: [deltaEvent({ text: "All Done." })] },
    { substring: "DONE" },
  );
  check("text_contains: string miss when case differs", !r.ok);
}
{
  const r = sessionChecks["session.text_contains"](
    { events: [deltaEvent({ text: "All Done." })] },
    { substring: ["DONE", "Done", "done"] },
  );
  check("text_contains: array any-of matches Done", r.ok, r.message);
}
{
  const r = sessionChecks["session.text_contains"](
    { events: [deltaEvent({ text: "fini" })] },
    { substring: ["DONE", "Done", "done"] },
  );
  check("text_contains: array any-of misses when none present", !r.ok);
}
{
  const r = sessionChecks["session.text_contains"](
    { events: [deltaEvent({ text: "hi" })] },
    {},
  );
  check("text_contains: rejects missing substring", !r.ok);
}
{
  const r = sessionChecks["session.text_contains"](
    { events: [deltaEvent({ text: "hi" })] },
    { substring: [] },
  );
  check("text_contains: rejects empty array", !r.ok);
}

// session.tool_called
{
  const r = sessionChecks["session.tool_called"](
    { events: [toolStart({ name: "bash", args: { cmd: "cat x" } })] },
    { name: "read" },
  );
  check("tool_called: string mismatches when only bash ran", !r.ok);
}
{
  const r = sessionChecks["session.tool_called"](
    { events: [toolStart({ name: "bash", args: { cmd: "cat x" } })] },
    { name: ["read", "bash"] },
  );
  check("tool_called: array any-of matches bash", r.ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
