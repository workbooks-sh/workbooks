---
name: lifecycle/mcp-serve-and-call
agent: workhorse
timeoutMs: 600000
setup:
  - kind: substrate.write_path
    path: workbooks/mcp-fixture-r5/workbook.config.mjs
    content: |
      export default {
        name: "MCP Fixture R5",
        slug: "mcp-fixture-r5",
        type: "spa",
        entry: "src/index.html",
        tools: [
          {
            name: "ping_r5_d4b1",
            description: "Round-trip sentinel; returns its input verbatim.",
            input_schema: {
              type: "object",
              properties: { token: { type: "string" } },
              required: ["token"],
            },
          },
        ],
      };
  - kind: substrate.write_path
    path: workbooks/mcp-fixture-r5/src/index.html
    content: |
      <!doctype html>
      <html>
        <body>
          <h1>mcp fixture r5</h1>
          <script type="module">
            // Tool handlers live in-page; the broker registers tool shape
            // at publish-time from workbook.config.mjs > tools.
            console.log("mcp-fixture-r5 loaded");
          </script>
        </body>
      </html>
  - kind: workbook.build
    workbookPath: workbooks/mcp-fixture-r5
    probe: false
  - kind: workbook.publish
    workbookPath: workbooks/mcp-fixture-r5
turns:
  - checks:
      - kind: substrate.file_contains
        path: workbooks/mcp-fixture-r5/workbook.config.mjs
        substring: "ping_r5_d4b1"
      - kind: mcp.call
        tool: ping_r5_d4b1
        args:
          token: "ROUNDTRIP-D4B1"
        expect:
          substring: "ping_r5_d4b1"
cleanup:
  - kind: substrate.remove_path
    path: workbooks/mcp-fixture-r5
---

# lifecycle/mcp-serve-and-call

Proves the publish surface registers tools and the call surface
routes invocations to the broker for that workbook.

Setup chain:

1. Write a fixture workbook whose `tools[]` declares a single tool
   `ping_r5_d4b1`. The unique suffix (`d4b1`) is the gate's
   sentinel: an agent that returns "I called the ping tool" without
   the suffix in scope would not pass the substrate check.
2. `workbook.build` produces the artifact (the tools manifest gets
   embedded by the inline-build pipeline).
3. `workbook.publish` registers the workbook with the broker. The
   broker stores `tools[]` so `/invoke` knows the tool exists.

Turn 1 is check-only:

- `substrate.file_contains` on the config confirms the tool name is
  in the source-of-truth before invocation — catches the
  "round-trip didn't actually persist the tool definition"
  exploit where the broker would have nothing to dispatch against.
- `mcp.call` invokes `ping_r5_d4b1` via `workbook call`, which goes
  through the same broker endpoint MCP clients use. The expect
  substring is the tool's own name — present in any sensible broker
  response (echoed in the deep-link URL when execution is queued,
  or in the structured payload once Cloudflare Worker Loader is
  GA). A response that omits the tool name entirely is either an
  error envelope or a wrong-tool dispatch; both are real failures.

This spec assumes the broker is online for the configured
`WORKBOOKS_BROKER`. If the broker is unreachable the `workbook
publish` action in setup will fail and the eval short-circuits to
fail before the turn runs.

Audit consideration: the substring `ping_r5_d4b1` is the tool's
own name, so it's NOT an "answer in the prompt" anti-pattern — the
prompt is empty in this spec (check-only). The substring is the
deterministic shape of any valid broker response addressed to this
tool. An exploit where the broker echoes the tool name in EVERY
response regardless of routing would pass; that's a broker
correctness bug, not a spec defect. Future hardening: assert on a
structured `result.tool` JSON field via expect.jsonField once the
broker returns a stable JSON envelope.

CAUTION: writes to public state at workbooks.sh.
