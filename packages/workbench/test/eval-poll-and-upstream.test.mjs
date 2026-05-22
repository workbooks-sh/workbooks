// Tests for wb-ojss.4 P2 + P3 primitives.

import test from "node:test";
import assert from "node:assert/strict";

import { pollChecks } from "../src/eval/checks/poll.mjs";
import { upstreamActions } from "../src/eval/actions/upstream.mjs";

test("session.poll_until: passes once predicate flips", async () => {
  let counter = 0;
  // Stub a predicate-shaped check using ctxRefs is overkill; instead
  // hand-roll a fake check kind via the predicate's runCheck pathway —
  // we simulate by using a kind that always exists. Easier: feed it
  // session.text_contains where ctx.events flips after N polls.
  const events = [];
  // We can't easily inject a fake registry into poll's import; instead,
  // exercise poll_until against a real check. Use the kind directly:
  const ctx = { events, substrate: null };
  const interval = 30;

  // Predicate: session.text_contains for "READY".
  const pred = { kind: "session.text_contains", substring: "READY" };

  // After 3 intervals (~90ms), populate the event log.
  setTimeout(() => {
    events.push({ kind: "message_delta", ts: 1, _id: 1, payload: { text: "READY", responseId: "r1" } });
  }, 100);

  const result = await pollChecks["session.poll_until"](ctx, {
    predicate: pred,
    interval_ms: interval,
    deadline_ms: 2000,
  });
  assert.equal(result.ok, true, result.message);
  counter++;
  assert.equal(counter, 1);
});

test("session.poll_until: fails on deadline", async () => {
  const ctx = { events: [], substrate: null };
  const result = await pollChecks["session.poll_until"](ctx, {
    predicate: { kind: "session.text_contains", substring: "NEVER" },
    interval_ms: 50,
    deadline_ms: 200,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /did not pass within/);
});

test("session.poll_until: rejects malformed predicate", async () => {
  const ctx = { events: [], substrate: null };
  const r1 = await pollChecks["session.poll_until"](ctx, { predicate: "not an object" });
  assert.equal(r1.ok, false);
  const r2 = await pollChecks["session.poll_until"](ctx, { predicate: {} });
  assert.equal(r2.ok, false);
});

test("upstream.inject: rotating status by request index", async () => {
  const ctx = {};
  const inject = await upstreamActions["upstream.inject"](ctx, {
    rules: [
      { url: "https://api.example.com/v1/chat", status: 429, after: 0, until: 2, body: '{"err":"slow down"}' },
      { url: "https://api.example.com/v1/chat", status: 200, after: 2, body: '{"ok":true}' },
    ],
  });
  assert.equal(inject.ok, true);
  assert.match(inject.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  // First two requests return 429, third returns 200. Hit via the
  // ?target= query mode (since the test process doesn't configure us
  // as an HTTP proxy).
  const targetEnc = encodeURIComponent("https://api.example.com/v1/chat");
  const url = `${inject.url}/?target=${targetEnc}`;
  const r1 = await fetch(url, { method: "POST", body: "{}" });
  assert.equal(r1.status, 429);
  const r2 = await fetch(url, { method: "POST", body: "{}" });
  assert.equal(r2.status, 429);
  const r3 = await fetch(url, { method: "POST", body: "{}" });
  assert.equal(r3.status, 200);
  const body3 = await r3.json();
  assert.equal(body3.ok, true);

  // Probe: request count gate.
  const probe = await upstreamActions["upstream.requests_for"](null, {
    url: "https://api.example.com/v1/chat",
    min: 3,
  });
  assert.equal(probe.ok, true);

  const probeFail = await upstreamActions["upstream.requests_for"](null, {
    url: "https://api.example.com/v1/chat",
    min: 100,
  });
  assert.equal(probeFail.ok, false);

  await upstreamActions["upstream.shutdown"](ctx);
});

test("upstream.inject: rejects missing rules", async () => {
  const r = await upstreamActions["upstream.inject"]({}, { rules: [] });
  assert.equal(r.ok, false);
  const r2 = await upstreamActions["upstream.inject"]({}, {});
  assert.equal(r2.ok, false);
});
