---
name: runway
description: Generate Gen-3 / Gen-4 videos via Runway. Text-to-video or image-to-video. Use when the user wants longer, higher-quality clips than fal.ai's video models produce, OR when the user names Gen-3 / Gen-4 specifically.
---

# Runway video generation

One tool: `generate_runway_video(prompt, model?, image_url?, duration_seconds?, ratio?)`.

## Model selection

| model           | quality | credits / 5s | use when                                  |
| --------------- | ------- | ------------ | ----------------------------------------- |
| `gen3a_turbo`   | good    | ~25          | default — most jobs                       |
| `gen4_turbo`    | better  | ~50          | hero shot, the user has settled on prompt |

Default comes from `providerPreferences.videoModel` for the runway provider; falls back to `gen3a_turbo`.

## Text-to-video vs image-to-video

If `image_url` is provided, Runway runs **image-to-video** — the image is the first frame, the prompt describes motion. Use this whenever a starting frame exists (or you just generated one via fal.ai / Replicate). Coherence is much better than pure text-to-video.

If `image_url` is omitted, it's **text-to-video** — Runway generates the whole clip from prompt alone. Acceptable for abstract / atmospheric clips; tends to drift for narrative scenes.

## Aspect ratios

| ratio       | use for       |
| ----------- | ------------- |
| `1280:768`  | default, 16:9 |
| `768:1280`  | vertical (social) |
| `1104:832`  | landscape 4:3 |
| `832:1104`  | portrait 4:3  |
| `960:960`   | square        |

## Output handling

Returns `{model, task_id, url, credits_used}`. Render the video:

```
render({kind: "video", src: result.url, caption: `Runway ${model} · ${credits_used} credits`})
```

Always mention `credits_used` so the user understands the cost — Runway bills in credits, not USD, and 25 credits can feel cheap or expensive depending on plan.

## Common pitfalls

- **Polling cap is 5 minutes.** Heavy jobs may hit it; warn the user up front.
- **duration_seconds** is 5 or 10 — model-dependent. `gen3a_turbo` accepts both.
- **Content filtering**: certain prompts (people, faces, violence) get filtered. Simplify and retry rather than re-prompting harder.
- **Image-to-video aspect mismatch**: if the source image isn't close to the chosen ratio, output gets letterboxed. Match the ratio to the image when possible.
