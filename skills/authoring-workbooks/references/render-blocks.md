# `render` block catalog

`render({block})` shows an interactive widget inline. Prefer it over dumping data as plain text in chat. Each block has a `kind` plus kind-specific fields.

## Block kinds

```
{ kind: "markdown",  text }                                              # text: full markdown
{ kind: "callout",   tone: "info"|"warn"|"error"|"ok", title?, text }    # text: markdown; title: plain
{ kind: "code",      lang?, code }                                       # code: literal — NO markdown
{ kind: "divider" }
{ kind: "metric",    label, value, delta? }                              # all fields plain
{ kind: "metrics",   items: [{label, value, delta?}, …] }                # all fields plain
{ kind: "image",     src, alt?, caption? }                               # caption: inline markdown; alt: plain
{ kind: "table",     columns: [...], rows: [[...], …], caption? }        # cells + caption: INLINE markdown only
{ kind: "chart",     chartKind: "bar"|"line", data: [{x, y}, …], title? } # title/axis: plain — SVG text
{ kind: "custom",    name, props? }                                      # only if the agent ships a custom component
```

## Markdown contract — critical

Fields tagged "markdown" or "inline markdown" parse `**bold**`, `*italic*`, backtick-code, lists, and links.

Fields tagged plain render the string verbatim. DO NOT write markdown into:
- `metric.value` / `metrics.items[].value` / `metrics.items[].label`
- `chart.title` / chart axis text
- `code.code` (literal source code only)
- `callout.title`
- `image.alt`

If you write `**42**` into `metric.value`, the literal asterisks render — they don't bold the number. This is the single most common mistake.

`callout.text` and table cells accept INLINE markdown only — bold, italic, code, links. No headings, no nested lists.

## Examples

```js
// Inline KPI strip after a query.
render({block:{kind:"metrics", items:[
  {label:"Requests", value:"1,204", delta:"+12%"},
  {label:"Errors",   value:"3",     delta:"-2"},
  {label:"P95",      value:"180ms"},
]}})

// Confirmation prompt before a destructive action.
render({block:{kind:"callout", tone:"warn", title:"About to delete 4 rows",
  text:"Tables: `users`, `sessions`. Reply 'yes' to proceed."}})

// Show a snippet WITHOUT processing it as markdown.
render({block:{kind:"code", lang:"js",
  code:"const x = '**not bold**';"}})
```

## When NOT to use `render`

- Long-form deliverables the user will want to keep, share, or revisit. Those go through `workbook init / build / publish`.
- The user already asked for a workbook by name. Render inline is for chat-shaped answers, not for the artifact itself.

## Custom blocks

`{kind:"custom", name, props?}` is only valid when the agent ships a component with that name (see `references/agent-shape.md` — components live in the manifest). Otherwise the canvas falls back to text.
