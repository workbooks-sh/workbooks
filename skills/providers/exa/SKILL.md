---
name: exa-web-search
description: Use the web_search tool for live-web lookups when the org has Exa connected. Exa is an embeddings-based ("neural") search engine built for AI agents — best for broad, semantic, "search by idea" queries and weak for exact identifiers or very obscure keywords. Auto-mode is the default and blends neural with keyword. Use when you need fresh facts, citations, or pages your training data doesn't cover.
---

# Exa web search

`web_search(query, max_results?)` dispatches to Exa when `WB_SEARCH_BACKEND=exa`. The runner hides the SDK; you just call the tool.

## What Exa is good at

Exa is a semantic, embeddings-based search engine — Exa frames it as "search by idea" vs Google's keyword matching. It shines when:

- The query is broad or conceptual (e.g. "papers on retrieval-augmented generation as a substitute for fine-tuning").
- You want recency filtering and citations.
- You're hunting for similar pages to one you already have.

It is **weaker** than keyword search when:

- The query is a specific identifier (a person's name, an acronym, a ticker symbol).
- The topic is obscure or local — keyword often wins.

Exa's own docs flag that neural search is "more chaotic and unpredictable" than keyword. If a search comes back empty or off-target, rephrasing as a semantic question usually helps; falling back to a keyword-leaning rewording also helps.

## Result shape

The `web_search` tool returns a JSON string. Each result has:

```
{ title, url, snippet, published, score }
```

Behind the scenes Exa returns more fields (`text`, `highlights`, `highlightScores`, `summary`, `author`, `image`, `favicon`, `costDollars`, `requestId`) — the runner currently normalizes to the five above. If you need the raw extras, that's a follow-up wiring.

`max_results` defaults to 8. Exa caps at 100 per request, costs $7/1k for the first 10 results then $1/1k per additional result.

## Latency

Exa publishes 180ms–1s end-to-end depending on `type` (`fast`/`auto`/`neural`/etc.). In practice, expect ~half a second for the default `auto` path. Don't pre-narrate "searching…" — by the time you finish the sentence, the call is done.

## When to call

Call `web_search` whenever the user asks something that:

- Is about recent events, current product state, or live pricing.
- Needs a source URL or citation.
- References something specific you can't confidently produce from memory.

Do not call it for:

- General knowledge well within training data.
- Math, code, or reasoning that doesn't need an external fact.
- Follow-up questions about a page the user already pasted in.

## Quirks

- Exa **deprecated** the top-level `score` field on auto-mode searches — use it as a hint, not a hard ranking signal.
- Date filtering exists upstream (`startPublishedDate` / `endPublishedDate` / `startCrawlDate` / `endCrawlDate`) but the simplified `web_search` tool doesn't expose it. If you need a date window, do the filter post-hoc on `published`.
- Exa has a separate `/contents` endpoint for retrieving full text of a URL you already have. Not wired into `web_search`; if you need page content, ask the user or use a fetch step.
- Free tier: 1,000 requests/month. Beyond that, every search costs the org.
