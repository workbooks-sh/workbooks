---
name: valyu-web-search
description: Use the web_search tool for live-web lookups when the org has Valyu connected. Valyu's differentiator is first-class access to 36+ proprietary corpora (PubMed, SEC filings, arXiv, US patents, ChEMBL, clinical trials, financial market data) alongside open-web search. Use when the question is academic, biomedical, financial, legal, or otherwise citation-heavy.
---

# Valyu web search

`web_search(query, max_results?)` dispatches to Valyu when `WB_SEARCH_BACKEND=valyu`. The runner hides the SDK; you just call the tool.

## What Valyu is good at

Valyu is a hybrid retrieval API that indexes the open web AND a large set of curated proprietary corpora, accessible through the same call:

- Academic: arXiv (~2.5M papers), PubMed (~37M biomedical papers)
- Legal/Regulatory: SEC filings (10-K, 10-Q, 8-K, 13F), US patents (~8M)
- Clinical: 500k+ clinical trials, ChEMBL chemistry data, drug labels
- Financial: market data, company reports
- Domain presets: `finance`, `medical`, `legal`, `genomics`, `chemistry`

Compared to Exa or Tavily, Valyu wins when the user wants **citations to authoritative sources** — papers, filings, trial records — not blog posts and SEO content. It is **weaker** as a general "anything goes" web search where Exa's neural/auto routing finds better matches.

## Result shape

The `web_search` tool returns a JSON string. Each result has:

```
{ title, url, snippet, published, score }
```

Valyu's raw response is much richer per result: `id`, `content` (markdown), `description`, `source`, `data_type` (unstructured / structured), `source_type` (website / paper / report / clinical_trial / drug_label / etc.), `relevance_score`, and academic-only fields like `doi`, `citation`, `citation_count`, `authors`, `references`. The runner normalizes to the five core fields above; the `score` field carries Valyu's `relevance_score` directly (0.0–1.0).

The runner currently hard-codes `search_type: "web"`. Valyu also supports `"all"` (web + proprietary), `"proprietary"` (academic / biomedical / etc.), and `"news"`. If you need those modes, that's a follow-up wiring — for now you only get the open-web slice.

`max_results` defaults to 8. Valyu caps `max_num_results` at 20 server-side.

## Cost

Valyu is **CPM-priced** (per 1,000 retrievals):

- Open databases / web: ~$0.50 / 1k
- Proprietary corpora: ~$30–$50 / 1k

$10 of free credit on signup. No subscription tiers. Each result carries its own `price` field; the response has `total_deduction_dollars`. The runner does not yet surface those — assume the open-web pricing band when reasoning about cost.

## When to call

Reach for Valyu-flavored searches (vs Exa or Firecrawl) when:

- The user wants citations to peer-reviewed papers, regulatory filings, or trial data.
- The topic is medical, financial, legal, or scientific.
- Answer quality depends on the source being authoritative, not just popular.

For general / consumer / product / tech-news queries, Exa or Firecrawl usually wins.

## Quirks

- The `error` field can be populated even when `success: true` — treat it as a warning, not a hard failure.
- Date filtering: setting only `end_date` defaults `start_date` to `1900-01-01`; setting only `start_date` defaults `end_date` to today. Not exposed through `web_search`.
- Content is returned as markdown, truncated per `response_length` (`short` / `medium` / `large` / `max`). Default `short` (~25K chars).
- `fast_mode` is web-only and bypasses LLM query rewriting — not exposed through `web_search`.
- No explicit rate limits are published.
