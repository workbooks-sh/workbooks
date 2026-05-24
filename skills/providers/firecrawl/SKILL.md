---
name: firecrawl-web-search
description: Use the web_search tool for live-web lookups when the org has Firecrawl connected. Firecrawl is search + clean-markdown scraping — heavier per call than Exa, but it can return real page content alongside results in one HTTP round trip. Use when you need both ranked URLs AND something close to the page body without a separate fetch.
---

# Firecrawl web search

`web_search(query, max_results?)` dispatches to Firecrawl when `WB_SEARCH_BACKEND=firecrawl`. The runner hides the SDK; you just call the tool.

## What Firecrawl is good at

Firecrawl's `/v2/search` endpoint is search-with-optional-scraping. Without `scrapeOptions`, it returns title/description/url for each hit — like any web search. With `scrapeOptions` enabled (not currently exposed through `web_search`), it can scrape each result inline and return clean markdown in the same response. The Firecrawl pipeline handles JS-rendered pages and strips boilerplate.

Use Firecrawl when:

- The agent needs results from JS-heavy sites that won't render in a plain fetch.
- Markdown-clean output matters for downstream summarization.
- You want to discover and read in one step (when richer scraping is wired).

It's **weaker** than Exa for:

- Pure semantic / concept queries — Firecrawl is a keyword/SERP-style search.
- Latency-sensitive paths — scraping each result adds seconds.

## Result shape

The `web_search` tool returns a JSON string. Each result has:

```
{ title, url, snippet, published, score }
```

Firecrawl's raw response carries more: `description`, `position`, `category`, and (when scrapeOptions is on) `markdown` / `html` / `links` / `screenshot` / `metadata`. The runner currently normalizes to the five fields above; `score` is derived from `position` (lower position → higher score).

`max_results` defaults to 8. Firecrawl caps `limit` at 100, defaults to 10.

## Cost + latency

Firecrawl bills credits: **2 credits per 10 search results**, plus **1 credit per page** when scraping is on top. Free tier is 1k credits; paid tiers scale from $0 to $599/yr. Rate limits range from 5/min (free) to 7,500/min (Scale).

Latency isn't published — but Firecrawl's default `timeout` of 60s and max of 300s implies multi-second responses, especially with scraping. Don't expect sub-second.

## When to call

Call `web_search` whenever the user asks something that needs the live web. Reach for Firecrawl-flavored searches (vs Exa) when:

- The result pages are JS-rendered SPAs.
- You're going to want clean page text shortly after the search.
- The query is a concrete keyword string, not a semantic concept.

## Quirks

- `query` is capped at 500 characters.
- Self-hosted Firecrawl: set `FIRECRAWL_BASE_URL` to your instance. The runner uses `/v2/search`; older self-hosted builds on `/v1` won't work without a base-URL override pointing at a proxy.
- Region: Firecrawl accepts `country` (default `"US"`) and `location` — not exposed through `web_search` yet. Add them upstream if a use case demands geo.
- Failed requests are usually not billed (the FIRE-1 agent is the exception).
- Credits do **not** roll over month to month.
