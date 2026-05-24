---
name: replicate
description: Run any model on Replicate's hosted API — text generation, image/audio/video generation, vision, embeddings, anything. Use when fal.ai doesn't have the model, when the user names a specific Replicate model, or when running a research-grade model that isn't on a faster platform.
---

# Replicate

One tool: `replicate_predict(model, input, timeout_seconds?)`. The tool blocks until the prediction completes; cheap models finish in <2s, heavy ones can take minutes.

## Model strings

Pass `model` as either:

- `owner/name` — auto-resolves to the latest version
- `owner/name:version_sha` — pins a specific 64-char SHA

Pin versions when reproducibility matters (e.g. a shared workbook that needs deterministic output). Use bare slugs when iterating.

## Input shape

Every Replicate model has its own input schema. You can't reliably guess it. Common patterns:

```
// LLM
{prompt: "...", max_tokens: 256, temperature: 0.7}

// Image gen
{prompt: "...", width: 1024, height: 1024}

// Image-to-image / inpainting
{image: "<url>", prompt: "...", mask: "<url>"}
```

When unsure: ask the user to paste the input schema from `replicate.com/<owner>/<name>/api`. Don't invent fields.

## Output handling

Tool returns `{model, version, id, output}`. The `output` shape varies:

| output type   | meaning              | render with                          |
| ------------- | -------------------- | ------------------------------------ |
| string        | text completion      | `render({kind:"markdown", text})`    |
| URL string    | image / audio / video | `render({kind:"image", src})` etc.  |
| URL array     | multi-image gen      | render each                          |
| object        | vision / classification | `render({kind:"table", rows})`    |

## Defaults

If the user omits `model` entirely, the tool falls back to `providerPreferences.chatModel` for the "replicate" provider. Set this in Studio (Inference tab → Replicate → chatModel) if your workflow keeps reaching for the same model.

## Common pitfalls

- **Models can disappear.** When their author archives them, the tool returns `model_not_found`. Suggest a similar model.
- **Cold-start latency**: 30–60s on rarely-called models. Warn the user.
- **Cost**: heavy models (SDXL, Llama-70B) are ~$0.01–0.10 per call. Don't loop without confirmation.
- **timeout_seconds default is 120**. Bump it for models you know take longer.
