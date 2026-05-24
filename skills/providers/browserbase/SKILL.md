---
name: browserbase-web-search
description: Notes on Browserbase as a search backend. Browserbase runs real cloud Chrome sessions and also exposes a dedicated Search API for cheap URL discovery. The runner-side dispatcher is not yet wired — `web_search` will refuse with a clear error when WB_SEARCH_BACKEND=browserbase. This skill is here so the agent knows what Browserbase offers and how to talk about it; come back when the dispatcher lands.
---

# Browserbase — search backend (stub)

`web_search(query, max_results?)` does NOT yet dispatch to Browserbase. If `WB_SEARCH_BACKEND=browserbase` is set on the org's runtime, the tool throws a clear "not yet implemented" error. This skill explains what Browserbase will be when the dispatcher lands so you can advise users coherently in the meantime.

## What Browserbase actually is

Browserbase is a cloud-Chrome service. Three layers, cheapest first:

1. **Search API** — a simple HTTP search call (~$7 per 1k searches, 120 req/min per project). Returns URL, title, plus optional author / publish date / image / favicon. This is the layer the eventual `web_search` dispatcher will use.
2. **Fetch API** — single-page content + headers + metadata. ~$1 per 1k calls ($4 with proxies). For when you have a URL and want clean page text without spinning up a session.
3. **Browser sessions** — real cloud Chrome, drivable by Playwright / Puppeteer / Stagehand. Per-session-minute billing ($0.10–$0.12 / browser-hour after free-tier hours). For interaction: clicking through SPAs, auth flows, downloads, screenshots, captcha solving.

Per Browserbase's own docs, the intended pattern is **Search → Fetch → Session**: discover URLs cheaply, fetch the ones that look promising, escalate to a full browser only when interaction is required.

## Why pick Browserbase over Exa / Firecrawl / Valyu

Reach for Browserbase when:

- The pages you need are JS-rendered SPAs that defeat plain fetch.
- The site requires authentication or session state.
- You'll want to follow up with clicks, form fills, downloads, or screenshots, not just read.

The other backends only ever read. Browserbase can act.

It is **weaker** than JSON search APIs (Exa, Valyu) for pure retrieval — slower, more expensive, and the result shape from the underlying Search API is less rich (no semantic ranking, no academic metadata).

## Regions

Four: `us-west-2` (Oregon, default), `us-east-1` (Virginia), `eu-central-1` (Frankfurt), `ap-southeast-1` (Singapore). Set per session, or globally per project.

## What to tell the user right now

If a user has connected Browserbase expecting `web_search` to work:

> Browserbase is connected, but the `web_search` tool's Browserbase dispatcher isn't wired yet. Pick Exa, Firecrawl, or Valyu as the search backend on your runtime for now, or wait for the Browserbase Search API integration to land.

Don't fake a result or fall through to another backend silently.

## When the dispatcher lands

The Search-API path will go in first (cheap, simple HTTP). Sessions / Fetch are a separate effort. Track it in beads under `wb-7bcp.1`.
