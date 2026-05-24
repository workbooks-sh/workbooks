---
name: vast-ai
description: Rent a GPU on Vast.ai's spot marketplace for one-off training, batch inference, or fine-tuning jobs. Use when the user wants more GPU power than fal.ai / Replicate / Modal provide, AND they're willing to wait 1–3 minutes for provisioning. Read this skill END-TO-END before calling — the terminate discipline matters.
---

# Vast.ai GPU rental

Two tools form the rental loop:

- `rent_gpu_instance(gpu_model, max_price_per_hour?, image?, disk_gb?)` — rent the cheapest matching offer
- `terminate_gpu_instance(instance_id)` — release it

## ⚠ CRITICAL: always terminate

Vast.ai charges every minute the instance is running. Always call `terminate_gpu_instance` when the job finishes — even on failure. Wrap your workflow:

```
let id = null;
try {
  const rented = JSON.parse(await rent_gpu_instance({gpu_model: "A100"}));
  id = rented.instance_id;
  // ... run the job ...
} finally {
  if (id) await terminate_gpu_instance({instance_id: id});
}
```

If you forget, the user keeps paying until the marketplace's auto-stop kicks in (varies, sometimes hours). **This is the #1 way to make a user angry with this tool.**

## Picking a GPU

`gpu_model` is a substring match against Vast's `gpu_name` field:

| model         | VRAM | typical $/hr | use for                                |
| ------------- | ---- | ------------ | -------------------------------------- |
| `RTX 4090`    | 24GB | $0.30–0.60   | exploration, small fine-tunes, batch inference |
| `A100`        | 40/80GB | $1–2      | research workhorse                     |
| `H100`        | 80GB | $2–4         | LLM training, large fine-tunes         |

Default `max_price_per_hour` is $5. If the user's job is exploratory, start with RTX 4090; only escalate when memory or speed forces it.

## Reliability is variable

Vast is a marketplace — providers are individuals. Each offer has a `reliability` score (0–1). The tool already filters to verified+rentable, but anything < 0.95 is risky for long jobs. Surface the reliability score to the user when it's borderline.

## Picking an image

Default is `pytorch/pytorch:latest`. Override when:

- The user needs a specific CUDA version → `nvidia/cuda:12.1-cudnn8-runtime-ubuntu22.04`
- The user has a specific framework → `tensorflow/tensorflow:latest-gpu`, `huggingface/transformers-pytorch-gpu`
- The user already has a custom Docker image they've published

## Output handling

`rent_gpu_instance` returns:

```
{
  instance_id: <number>,
  offer: {gpu_name, gpu_count, dph_total, reliability},
  estimated_cost_per_hour: <number>,
  image: "..."
}
```

Tell the user the estimated cost and reliability BEFORE they proceed with the job. If they're surprised by the cost, terminate immediately.

## Common pitfalls

- **Startup is 1–3 minutes.** Don't poll faster than once per 30s.
- **No SSH details in the rent response.** Use Vast's web console for SSH; or pass a startup script via custom image entrypoint.
- **No matching offers** — bump `max_price_per_hour` or try a different gpu_model. Vast's inventory varies hourly.
- **Spot interruption is possible** on long jobs. For multi-hour training, consider Modal or Lambda Labs (more reliable, fixed pricing).
