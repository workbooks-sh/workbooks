#!/usr/bin/env node
// shape-drift-ok: tests intentionally exercise the legacy type:"playground"
// back-compat codepath alongside the canonical type:"spa" + stage flow.

// wb-22u.9 / wb-22u.10 — config validation tests.
//
// Covers:
//   - playground.wraps: bare slugs rejected with clear error
//   - playground.wraps: http(s)://, /, ./, ../ all accepted
//   - params: snake_case names, type enforcement, well-formed schemas
//   - params: existing workbooks with no params field unaffected

import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { loadConfig } from "../src/util/config.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
  if (ok) pass++; else fail++;
}

async function withConfig(body, cb) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wb-cfg-"));
  await fs.writeFile(path.join(tmp, "workbook.config.mjs"), body);
  await fs.writeFile(path.join(tmp, "index.html"), "<!doctype html><html><body></body></html>");
  try { return await cb(tmp); }
  finally { await fs.rm(tmp, { recursive: true, force: true }); }
}

function makePlaygroundConfig(wraps) {
  return `export default {
    slug: "pg",
    entry: "index.html",
    type: "playground",
    playground: { wraps: ${JSON.stringify(wraps)} },
  };`;
}

function makeParamsConfig(paramsLiteral) {
  return `export default {
    slug: "p",
    entry: "index.html",
    params: ${paramsLiteral},
  };`;
}

async function expectThrow(body, matcher) {
  return withConfig(body, async (dir) => {
    try {
      await loadConfig(dir);
      return { threw: false, msg: "" };
    } catch (e) {
      return { threw: true, msg: e.message, ok: matcher(e.message) };
    }
  });
}

async function expectPass(body) {
  return withConfig(body, async (dir) => {
    try {
      const cfg = await loadConfig(dir);
      return { ok: true, cfg };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  });
}

async function main() {
  /* wraps: bare slug rejected */
  {
    const r = await expectThrow(
      makePlaygroundConfig("my-slug"),
      (m) => m.includes("must be a URL or relative path") &&
             m.includes("'my-slug'") &&
             m.includes("Bare slugs aren't supported"),
    );
    check("wraps: bare slug rejected", r.threw && r.ok, { msg: r.msg });
  }

  /* wraps: each accepted prefix */
  for (const w of [
    "https://x.example/y.html",
    "http://x.example/y.html",
    "/abs/path.html",
    "./sibling.html",
    "../other/dist/x.html",
  ]) {
    const r = await expectPass(makePlaygroundConfig(w));
    check(`wraps: '${w}' accepted`, r.ok && r.cfg.playground.wraps === w, { msg: r.msg });
  }

  /* params: no-params config unaffected */
  {
    const r = await expectPass(`export default { slug: "p", entry: "index.html" };`);
    check("params: omitted → empty object", r.ok && Object.keys(r.cfg.params).length === 0);
  }

  /* params: valid shape passes */
  {
    const r = await expectPass(makeParamsConfig(`{
      hue: { type: "number", minimum: 0, maximum: 360, default: 180 },
      mode: { type: "string", enum: ["a", "b"], default: "a" },
      count: { type: "integer", default: 3 },
      flag: { type: "boolean", default: false },
    }`));
    check("params: well-formed shape accepted", r.ok, { msg: r.msg });
    if (r.ok) {
      check("params: hue preserved", r.cfg.params.hue.minimum === 0 && r.cfg.params.hue.maximum === 360);
      check("params: mode enum preserved", Array.isArray(r.cfg.params.mode.enum) && r.cfg.params.mode.enum.length === 2);
      check("params: default preserved", r.cfg.params.count.default === 3);
    }
  }

  /* params: bad type rejected */
  {
    const r = await expectThrow(
      makeParamsConfig(`{ x: { type: "array" } }`),
      (m) => m.includes("params.x.type") && m.includes("number"),
    );
    check("params: invalid type rejected", r.threw && r.ok, { msg: r.msg });
  }

  /* params: bad name rejected */
  {
    const r = await expectThrow(
      makeParamsConfig(`{ "BadName": { type: "number" } }`),
      (m) => m.includes("snake_case"),
    );
    check("params: non-snake_case rejected", r.threw && r.ok, { msg: r.msg });
  }

  /* params: missing type rejected */
  {
    const r = await expectThrow(
      makeParamsConfig(`{ x: { minimum: 0 } }`),
      (m) => m.includes("params.x.type"),
    );
    check("params: missing type rejected", r.threw && r.ok, { msg: r.msg });
  }

  /* params: empty enum rejected */
  {
    const r = await expectThrow(
      makeParamsConfig(`{ x: { type: "string", enum: [] } }`),
      (m) => m.includes("non-empty array"),
    );
    check("params: empty enum rejected", r.threw && r.ok, { msg: r.msg });
  }

  /* params + tools coexist — separate fields */
  {
    const r = await expectPass(`export default {
      slug: "p", entry: "index.html",
      tools: { lookup: { description: "x", input_schema: { type: "object" } } },
      params: { hue: { type: "number", minimum: 0, maximum: 360 } },
    };`);
    check("params + tools coexist", r.ok, { msg: r.msg });
    if (r.ok) {
      check("tools preserved alongside params", Array.isArray(r.cfg.tools) && r.cfg.tools.length === 1);
      check("params not merged into tools", r.cfg.tools[0].name === "lookup" && !("hue" in r.cfg.tools[0]));
    }
  }

  /* capabilities: omitted → empty object */
  {
    const r = await expectPass(`export default {
      slug: "c", entry: "index.html", type: "spa",
    };`);
    check("capabilities: omitted → empty object", r.ok && Object.keys(r.cfg.capabilities ?? {}).length === 0, { msg: r.msg });
  }

  /* capabilities: well-formed block accepted */
  {
    const r = await expectPass(`export default {
      slug: "c", entry: "index.html", type: "spa",
      capabilities: {
        "llm:openrouter": { scope: "group" },
        "oauth:google_drive": { scope: "user" },
        "env:BRAVE_SEARCH_KEY": { scope: "group", inject: "header:X-Subscription-Token", domains: ["api.search.brave.com"] },
      },
    };`);
    check("capabilities: well-formed shape accepted", r.ok, { msg: r.msg });
    if (r.ok) {
      check("capabilities: llm slug preserved", r.cfg.capabilities["llm:openrouter"]?.scope === "group");
      check("capabilities: env extras preserved", r.cfg.capabilities["env:BRAVE_SEARCH_KEY"]?.inject === "header:X-Subscription-Token");
    }
  }

  /* capabilities: invalid scope rejected */
  {
    const r = await expectThrow(
      `export default {
        slug: "c", entry: "index.html", type: "spa",
        capabilities: { "llm:openrouter": { scope: "global" } },
      };`,
      (m) => m.includes("capabilities") && m.includes("scope"),
    );
    check("capabilities: invalid scope rejected", r.threw && r.ok, { msg: r.msg });
  }

  /* capabilities: array form rejected */
  {
    const r = await expectThrow(
      `export default {
        slug: "c", entry: "index.html", type: "spa",
        capabilities: [{ slug: "llm:openrouter" }],
      };`,
      (m) => m.includes("capabilities") && m.includes("object"),
    );
    check("capabilities: array form rejected", r.threw && r.ok, { msg: r.msg });
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(2);
});
