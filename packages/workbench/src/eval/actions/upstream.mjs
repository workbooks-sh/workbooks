// upstream.* — wb-ojss.4 P2.
//
// Fake-upstream injector: launches a small HTTP shim that returns
// chosen status codes for chosen URL patterns. The agent's sandbox
// must be configured to route its outbound provider traffic through
// the shim — typically via a proxy env var threaded through the
// broker's sandbox provisioning code.
//
// SCOPE NOTE: this action ships the shim primitive ONLY. Routing the
// sandbox's outbound traffic through it is operator setup outside this
// package's reach (`WORKBOOKS_UPSTREAM_PROXY=...` on the sandbox
// runner). For dry-parse and unit tests the shim is enough; live runs
// of `evals/concurrency/upstream_5xx.eval.md` require the proxy wiring
// to be in place.
//
// Lifecycle: each call to `upstream.inject` (re)starts a shim with the
// requested rule set; `upstream.shutdown` (auto-fired in cleanup) tears
// it down. The shim address is exposed via ctx.upstreamProxyUrl so
// downstream specs / actions can read it.

import http from "node:http";

const ACTIVE_SHIMS = new WeakMap();

export const upstreamActions = {
  /**
   * Launch (or replace) the fake-upstream shim with a rule list.
   *
   *   - kind: upstream.inject
   *     rules:
   *       - url: "https://api.openai.com/v1/chat/completions"
   *         status: 429
   *         after: 0          # apply to ALL requests (0 = first onward)
   *         until: 2          # only the first 2 (0-indexed: req 0, 1)
   *         body: |
   *           {"error":{"message":"rate limited"}}
   *       - url: "https://api.openai.com/v1/chat/completions"
   *         status: 200
   *         after: 2          # 3rd request onward — success
   *         body: '{"ok":true}'
   *
   * Rules are evaluated top-down per request; first match wins.
   */
  "upstream.inject": async (ctx, params) => {
    if (!params || !Array.isArray(params.rules) || params.rules.length === 0) {
      return { ok: false, message: `upstream.inject: requires "rules" (non-empty array)` };
    }
    for (let i = 0; i < params.rules.length; i++) {
      const r = params.rules[i];
      if (!r || typeof r.url !== "string") {
        return { ok: false, message: `upstream.inject: rule ${i} requires "url" (string)` };
      }
      if (typeof r.status !== "number") {
        return { ok: false, message: `upstream.inject: rule ${i} requires "status" (number)` };
      }
    }

    const prev = ACTIVE_SHIMS.get(globalRef());
    if (prev) await prev.shutdown();

    const shim = await startShim(params.rules);
    ACTIVE_SHIMS.set(globalRef(), shim);

    if (ctx) {
      // Surface address on ctx so the runner / sandbox provisioning can
      // pick it up. Threading this into the sandbox env is operator
      // setup — see SCOPE NOTE above.
      ctx.upstreamProxyUrl = shim.url;
      ctx.upstreamShim = shim; // for tests + shutdown
    }
    return { ok: true, url: shim.url, rules: params.rules.length };
  },

  "upstream.shutdown": async (ctx) => {
    const shim = ACTIVE_SHIMS.get(globalRef());
    if (!shim) return { ok: true, message: "no shim active" };
    await shim.shutdown();
    ACTIVE_SHIMS.delete(globalRef());
    if (ctx) {
      ctx.upstreamProxyUrl = null;
      ctx.upstreamShim = null;
    }
    return { ok: true };
  },

  /**
   * Read-only probe: how many requests has the shim handled for a
   * given URL? Used by specs to gate on "the agent actually hit the
   * upstream N times" — proves the failure injection was exercised.
   *
   *   - kind: upstream.requests_for
   *     url: "https://api.openai.com/v1/chat/completions"
   *     min: 3
   */
  "upstream.requests_for": async (_ctx, params) => {
    const shim = ACTIVE_SHIMS.get(globalRef());
    if (!shim) {
      return { ok: false, message: "upstream.requests_for: no shim active" };
    }
    if (!params || typeof params.url !== "string") {
      return { ok: false, message: `upstream.requests_for: requires "url" (string)` };
    }
    const min = typeof params.min === "number" ? params.min : 1;
    const got = shim.countFor(params.url);
    if (got < min) {
      return {
        ok: false,
        message: `upstream.requests_for: ${params.url} got ${got} request${got === 1 ? "" : "s"}, want ≥${min}`,
      };
    }
    return { ok: true, message: `${got} request${got === 1 ? "" : "s"} matched ${params.url}` };
  },
};

function globalRef() {
  // Singleton-per-process: tests and runner share one shim slot.
  return globalThis;
}

async function startShim(rules) {
  const counts = new Map();
  const server = http.createServer((req, res) => {
    const target = extractTarget(req);
    const n = (counts.get(target) ?? 0);
    counts.set(target, n + 1);
    const match = matchRule(rules, target, n);
    if (!match) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "no rule matched", url: target }));
      return;
    }
    res.statusCode = match.status;
    if (match.headers && typeof match.headers === "object") {
      for (const [k, v] of Object.entries(match.headers)) res.setHeader(k, String(v));
    }
    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "application/json");
    }
    res.end(typeof match.body === "string" ? match.body : (match.body == null ? "" : JSON.stringify(match.body)));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    countFor(targetUrl) { return counts.get(targetUrl) ?? 0; },
    async shutdown() {
      await new Promise((res) => server.close(() => res()));
    },
  };
}

function extractTarget(req) {
  // The shim accepts two shapes:
  //   1) Direct: the client called us with the target URL in the path
  //      (e.g. `POST http://127.0.0.1:PORT/?target=https://api.openai.com/...`)
  //   2) Proxy: the client used us as an HTTP forward-proxy; the full
  //      URL is in req.url (which Node sets to the absolute URL for
  //      proxy CONNECT/POST). We don't actually forward — we match the
  //      target against the rule set.
  if (req.url && /^https?:\/\//i.test(req.url)) return req.url;
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (u.searchParams.has("target")) return u.searchParams.get("target");
  // Last resort: synthesize from host header.
  const host = req.headers?.host ?? "127.0.0.1";
  return `http://${host}${req.url ?? "/"}`;
}

function matchRule(rules, url, requestIdx) {
  for (const r of rules) {
    if (!urlMatches(r.url, url)) continue;
    const after = typeof r.after === "number" ? r.after : 0;
    const until = typeof r.until === "number" ? r.until : Infinity;
    if (requestIdx < after) continue;
    if (requestIdx >= until) continue;
    return r;
  }
  return null;
}

function urlMatches(pattern, url) {
  if (pattern === url) return true;
  // Treat patterns as prefix matches if they end with /, otherwise
  // require equality. Wildcards (regex) not supported yet — keep
  // matching boring + diff-friendly.
  if (pattern.endsWith("/") && url.startsWith(pattern)) return true;
  if (pattern.endsWith("*")) {
    const base = pattern.slice(0, -1);
    return url.startsWith(base);
  }
  return false;
}
