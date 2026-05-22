// Spec parser tests for wb-ojss.4 P1 dual-session mode.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSpec } from "../src/eval/spec.mjs";

async function withTempSpec(body, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-spec-test-"));
  const file = path.join(dir, "x.eval.md");
  await fs.writeFile(file, body, "utf8");
  try { return await fn(file); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test("multi-session: parses sessions + per-turn session + after", async () => {
  const body = `---
name: concurrency/probe
sessions:
  - id: alpha
    agent: workhorse
  - id: beta
    agent: workhorse
turns:
  - session: alpha
    prompt: hi
    checks: []
  - session: beta
    after: alpha.turn.0
    prompt: hi back
    checks: []
---
`;
  await withTempSpec(body, async (f) => {
    const spec = await loadSpec(f);
    assert.equal(spec.sessions.length, 2);
    assert.deepEqual(spec.sessions.map((s) => s.id), ["alpha", "beta"]);
    assert.equal(spec.turns[0].session, "alpha");
    assert.equal(spec.turns[1].session, "beta");
    assert.deepEqual(spec.turns[1].after, { sessionId: "alpha", turnIdx: 0 });
  });
});

test("multi-session: rejects unknown session reference", async () => {
  const body = `---
name: x
sessions:
  - id: alpha
    agent: workhorse
turns:
  - session: nope
    prompt: hi
    checks: []
---
`;
  await withTempSpec(body, async (f) => {
    await assert.rejects(() => loadSpec(f), /unknown session "nope"/);
  });
});

test("multi-session: rejects unknown after reference", async () => {
  const body = `---
name: x
sessions:
  - id: alpha
    agent: workhorse
turns:
  - session: alpha
    prompt: hi
    checks: []
  - session: alpha
    after: ghost.turn.0
    prompt: hi
    checks: []
---
`;
  await withTempSpec(body, async (f) => {
    await assert.rejects(() => loadSpec(f), /unknown session "ghost"/);
  });
});

test("multi-session: rejects malformed after", async () => {
  const body = `---
name: x
sessions:
  - id: alpha
    agent: workhorse
turns:
  - session: alpha
    after: notvalid
    prompt: hi
    checks: []
---
`;
  await withTempSpec(body, async (f) => {
    await assert.rejects(() => loadSpec(f), /must match/);
  });
});

test("single-session: unchanged behavior, no session field needed", async () => {
  const body = `---
name: x
agent: workhorse
turns:
  - prompt: hi
    checks: []
---
`;
  await withTempSpec(body, async (f) => {
    const spec = await loadSpec(f);
    assert.equal(spec.sessions, null);
    assert.equal(spec.turns[0].session, null);
    assert.equal(spec.turns[0].after, null);
  });
});

test("multi-session: per-session agent override + default fallback", async () => {
  const body = `---
name: x
agent: workhorse
sessions:
  - id: alpha
  - id: beta
    agent: claude
turns:
  - session: alpha
    prompt: hi
    checks: []
  - session: beta
    prompt: hi
    checks: []
---
`;
  await withTempSpec(body, async (f) => {
    const spec = await loadSpec(f);
    assert.equal(spec.sessions[0].agent, "workhorse");
    assert.equal(spec.sessions[1].agent, "claude");
  });
});

test("multi-session: duplicate session ids rejected", async () => {
  const body = `---
name: x
sessions:
  - id: alpha
    agent: workhorse
  - id: alpha
    agent: workhorse
turns:
  - session: alpha
    prompt: hi
    checks: []
---
`;
  await withTempSpec(body, async (f) => {
    await assert.rejects(() => loadSpec(f), /duplicate session id/);
  });
});
