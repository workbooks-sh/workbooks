---
name: vercel-agent-browser
description: Notes on the vercel-labs/agent-browser CLI as a "search" backend. It's an open-source Rust CLI that drives a real Chrome browser via shell commands — no API key needed. Cannot run in the WebContainer sandbox (no native binaries, no Chrome). Requires a cloud sandbox (E2B, Daytona, Vercel Sandbox). The runner-side dispatcher is not yet wired; web_search throws a clear "not yet implemented" message when this backend is selected.
---

# Vercel Agent Browser (CLI) — backend notes

`web_search(query, max_results?)` does NOT yet dispatch to the Vercel agent-browser CLI. If `WB_SEARCH_BACKEND=vercel-agent-browser` is set on the org's runtime, the tool throws "not yet implemented." This skill is here so the agent understands what the backend actually is and can advise users while the dispatcher is built.

## What it is

The `vercel-labs/agent-browser` CLI (github.com/vercel-labs/agent-browser) is an open-source Rust binary built for AI coding agents to drive a real Chrome browser via shell commands:

```
agent-browser open <url>
agent-browser click @e1
agent-browser snapshot
```

A background daemon keeps the session warm. Returns snapshot-based semantic refs (`@e1`, `@e2`) plus text/screenshots — ~93% fewer tokens than raw DOM dumps per Vercel's marketing.

**No API key required.** Apache-2.0, free. You bring your own Chrome (local Chrome for Testing) or plug in a remote provider (Browserbase, Browserless, Kernel, Browser Use, AWS AgentCore). Latest release is in the v0.27.x range.

## Where it can run

| Sandbox       | Can it run agent-browser? | Why |
|---------------|---------------------------|-----|
| WebContainer  | **No**                    | No native binary execution; no Chrome; no CDP. |
| E2B           | Yes                       | Real Linux VM, can install + run the Rust CLI and Chrome for Testing. |
| Daytona       | Yes                       | Same. |
| Vercel Sandbox| Yes                       | Same. |

If the runtime is set to WebContainer and an agent tries to use this backend, the dispatcher will refuse with a clear "requires cloud sandbox" message. Studio's runtime picker should disable this option when sandbox=webcontainer.

## Why pick it over Exa / Firecrawl / Valyu

The other three backends are JSON search APIs — they can only **read** ranked URLs/snippets. Agent-browser can **act**: click through SPAs, fill forms, complete auth flows, follow redirects, take screenshots, download files. Reach for it when the task isn't "find a URL" but "drive a real browser."

Disadvantages vs the JSON backends:

- Slower per query (real browser, real Chrome).
- Heavier setup — needs Chrome + the CLI installed in the sandbox.
- Cost depends on the underlying provider (free if it drives a local/sandbox Chrome; per-minute if it routes to Browserbase / Kernel / Browser Use).

## What to tell the user right now

If the user picked Vercel Agent Browser:

> The Vercel agent-browser CLI dispatcher isn't wired in the runner yet — when it lands, it'll install and drive the open-source Rust CLI inside your E2B/Daytona/Vercel sandbox. For now, pick Exa, Firecrawl, or Valyu as the search backend. Follow `wb-7bcp.2` if you want to track the work.

If their runtime is on WebContainer:

> The Vercel agent-browser CLI is a native Rust binary that needs Chrome — neither can run in WebContainer. Switch your runtime to E2B, Daytona, or Vercel Sandbox before selecting this backend.

## Disambiguation — what this is NOT

- **Not** Vercel AI Gateway's web-search capability (`parallelSearch` / `perplexitySearch`). Those are hosted JSON search APIs billed per-1k requests via the AI SDK. Different product, different invocation path.
- **Not** Vercel Sandbox (which we wire as a sandbox option in the runtime, unrelated to search).

## When the dispatcher lands

The plan: at session start, if `WB_SEARCH_BACKEND=vercel-agent-browser` AND sandbox is not webcontainer, the runner installs `agent-browser` + Chrome for Testing inside the sandbox and exposes `web_search(query)` by issuing the CLI commands needed for a search (open the SERP, snapshot, parse). Result shape normalizes onto `{ title, url, snippet, published, score }` like the other backends. Track under `wb-7bcp.2`.
