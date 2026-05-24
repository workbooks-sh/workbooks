---
name: fal-ai-generation
description: Generate images and short videos via fal.ai. Use when the user asks to "make an image", "create a picture", "generate a clip", or wants to visualize something the agent can describe textually. Default model is fal-ai/flux/schnell for images and fal-ai/ltx-video for videos; override per-call when a specific model fits better.
---

# fal.ai image and video generation

You have two tools backed by fal.ai's hosted inference API. Both require `FAL_KEY` in the env — when the org hasn't connected fal in Studio, these tools won't register and the user has to set it up first.

- `generate_image(prompt, model?, image_size?, num_images?)` — text-to-image
- `generate_video(prompt, model?, duration_seconds?, image_url?)` — text-to-video or image-to-video

Default models come from the org's preferences. Override per-call only when you have a concrete reason.

## Picking a model

**Images:**

| model                                 | use when                                 | speed |
| ------------------------------------- | ---------------------------------------- | ----- |
| `fal-ai/flux/schnell`                 | default — iterative prototyping          | <2s   |
| `fal-ai/flux-pro`                     | final, higher quality                    | 5–10s |
| `fal-ai/stable-diffusion-v3-medium`   | alternative when Flux output looks wrong | 3–5s  |

**Videos:**

| model                       | use when                                  | duration |
| --------------------------- | ----------------------------------------- | -------- |
| `fal-ai/ltx-video`          | default — fast text-to-video              | 5s       |
| `fal-ai/runway-gen3-turbo`  | higher quality (or use `generate_runway_video` if Runway is connected directly) | 5/10s |

## Output handling

Both tools return a JSON string. Parse it, then surface the result with a `render` block — don't paste raw URLs in chat.

```
const r = JSON.parse(await generate_image({prompt: "..."}));
render({kind: "image", src: r.urls[0], alt: "<short alt text>"});
```

For multiple images, render each in turn. For video, use `{kind: "video", src: r.url}`.

## Common pitfalls

- **Don't pre-narrate latency.** Image gen is sub-second cold-start. Just call.
- **Do pre-narrate video.** 10–60 seconds. Tell the user "generating, hang on…" before the call.
- **num_images > 4 is rare.** Prefer iteration over batch.
- **Aspect ratio**: pass `image_size: "square_hd" | "portrait_4_3" | "landscape_4_3" | "landscape_16_9"`.
- **image_url + generate_video** runs image-to-video. Coherent motion needs a clear subject — if the input image is busy, the output may glitch.
