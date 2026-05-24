---
name: modal
description: Dispatch a deployed Modal web endpoint. Use when the user wants to run heavy compute (GPU jobs, batch processing, training, custom inference) they've already deployed to Modal. The tool calls existing deployments — it doesn't create them.
---

# Modal function dispatch

One tool: `dispatch_modal_function(url, input?, method?, timeout_seconds?)`. POSTs JSON to a Modal web endpoint and returns whatever the function returns.

## Prerequisites

The user must have deployed a function decorated with `@modal.web_endpoint()` via `modal deploy`. The function becomes reachable at:

```
https://<workspace>--<app-name>-<function-name>.modal.run
```

If the user asks you to call something they haven't deployed, **don't try to deploy it for them** — that requires the Modal CLI and their machine. Tell them:

1. `pip install modal` (one time)
2. `modal token set ...` (configure auth)
3. Write the function with `@modal.web_endpoint()` decoration
4. `modal deploy file.py`
5. Share the resulting URL

## Calling

```
dispatch_modal_function({
  url: "https://shane-25168--my-app-classify.modal.run",
  input: {image_url: "https://...", threshold: 0.5},
  timeout_seconds: 120
})
```

The tool sends `input` as the JSON body. Modal endpoints typically expect JSON; if the user's endpoint expects multipart or query-string args, you'll get a 400 — ask the user to redeploy with FastAPI-style JSON.

## Auth

When the org has connected a Modal token pair (Inference tab → Modal), the tool automatically sends `Modal-Key` + `Modal-Secret` headers. This authenticates against endpoints decorated with `@modal.web_endpoint(auth_token=True)`. Public endpoints ignore the headers.

If you get a 401/403 and the user's endpoint should be public, double-check the URL. If it should be private, verify the token pair in Studio.

## Output handling

Tool returns `{status, body}`. `body` is parsed JSON when the response is JSON, raw text otherwise. Pass results back to the user with appropriate context — Modal functions typically return structured data, not URLs, so a `render({kind: "code"})` or `render({kind: "table"})` block usually fits better than `image`.

## Common pitfalls

- **Cold-start latency on GPU functions: 30–90s.** Tell the user before the call.
- **Free tier cap**: 60 GPU-minutes / month. Heavy use hits the cap fast.
- **No deployment from inside the agent.** The tool calls existing endpoints. Always.
- **Timeout default is 300s.** For training jobs, bump this; for quick inference, lower it so failures fail fast.
