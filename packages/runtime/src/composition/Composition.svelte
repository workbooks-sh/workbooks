<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import {
    parseDocument,
    resolveTimeline,
    type Asset,
    type CwXmlDocument,
    type ResolvedShot,
    type ResolvedTimelineFlat,
  } from "@work.books/cw-xml";
  import { getTheaterContext } from "./context";
  import { compileShotTimeline, type CompiledTimeline } from "./gsapRunner";
  import ClipVideo from "./ClipVideo.svelte";
  import Captions from "./Captions.svelte";
  import {
    loadTranscript,
    resolveAnalysisUrl,
    type AudioWord,
  } from "./captions";
  import { AudioMixer } from "./audioMixer";

  let {
    src,
    xml,
    id,
    class: className = "",
    transcripts = {},
    children,
  }: {
    src?: string;
    /**
     * Inline CW XML string. Use this when the workbook ships as a
     * single-file artifact and you can't rely on `fetch()` to resolve
     * `src`. Bundlers like Vite let you import an .xml as raw text:
     *   `import introXml from "./intro.xml?raw";`
     */
    xml?: string;
    id?: string;
    class?: string;
    /**
     * Pre-loaded transcript data keyed by analysis id. Accepts either
     * the strict `AudioWord[]` shape (camelCase) or the raw JSON
     * shape with `start_ms` / `end_ms`. Use this when the single-file
     * artifact has the transcript inlined via
     * `import t1 from "../transcript.words.json";` — saves the runtime
     * fetch, which would fail in an offline `.html`.
     */
    transcripts?: Record<string, AudioWord[] | Array<{ text: string; start_ms?: number; end_ms?: number; startMs?: number; endMs?: number }>>;
    /**
     * Optional child snippet rendered as the canvas content. When
     * provided it overrides the auto-fetched HyperFrames HTML, letting
     * authors compose with Svelte components in-place. The snippet
     * receives no args; use the theater context to drive UI off the
     * playhead.
     */
    children?: import("svelte").Snippet;
  } = $props();

  const theater = getTheaterContext();
  const compositionId = $derived(id ?? (src ? deriveIdFromSrc(src) : `composition-${nextAnonId()}`));

  let timeline = $state<ResolvedTimelineFlat | null>(null);
  let assetIndex = $state<Map<string, Asset>>(new Map());
  let baseUrl = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let sceneHtml = $state<Map<string, string>>(new Map());
  let containerEl = $state<HTMLDivElement | null>(null);
  /** Resolved transcripts keyed by analysis id. */
  let transcriptWords = $state<Map<string, AudioWord[]>>(new Map());

  const isActive = $derived(theater.currentCompositionId === compositionId);
  const activeShotId = $derived.by(() => {
    if (!isActive || !timeline) return null;
    const f = theater.playheadFrame;
    for (const entry of timeline.entries) {
      if (entry.source === "shot" && f >= entry.startFrame && f < entry.endFrame) {
        return entry.id;
      }
    }
    return null;
  });

  const activeSceneId = $derived.by(() => {
    if (!isActive || !timeline) return null;
    const f = theater.playheadFrame;
    for (const entry of timeline.entries) {
      if (entry.source === "scene" && f >= entry.startFrame && f < entry.endFrame) {
        return entry.id;
      }
    }
    return null;
  });

  async function loadXmlFromText(text: string, url: string | null): Promise<void> {
    try {
      const doc = parseDocument(text);
      const resolved = resolveTimeline(doc);
      timeline = resolved;
      baseUrl = url;
      const idx = new Map<string, Asset>();
      for (const a of doc.assets) idx.set(a.id, a);
      assetIndex = idx;
      theater.updateComposition(compositionId, {
        fps: resolved.fps,
        timeline: resolved,
      });
      await loadCaptionTranscripts(doc, url);
      if (url) await loadSceneAssets(url, doc);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      console.error("[workbook-composition]", loadError);
    }
  }

  async function loadXml(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
      const text = await res.text();
      await loadXmlFromText(text, url);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      console.error("[workbook-composition]", loadError);
    }
  }

  async function loadSceneAssets(xmlUrl: string, doc: CwXmlDocument): Promise<void> {
    if (children) return;
    const base = new URL(xmlUrl, window.location.href);
    const next = new Map(sceneHtml);
    const seen = new Set<string>();
    for (const seq of doc.sequences) {
      for (const scene of seq.scenes) {
        const ref = scene.composition;
        if (!ref || seen.has(ref)) continue;
        seen.add(ref);
        if (next.has(ref)) continue;
        try {
          const url = new URL(ref, base);
          const res = await fetch(url);
          if (!res.ok) continue;
          const html = await res.text();
          next.set(ref, html);
        } catch {
          // Best-effort; missing HF HTML degrades to an empty container.
        }
      }
    }
    sceneHtml = next;
  }

  function normaliseInlineWords(arr: any[]): AudioWord[] {
    if (!Array.isArray(arr)) return [];
    return arr.map((w) => ({
      text: String(w.text ?? ""),
      startMs: Number(w.startMs ?? w.start_ms ?? 0),
      endMs: Number(w.endMs ?? w.end_ms ?? 0),
    }));
  }

  async function loadCaptionTranscripts(doc: CwXmlDocument, xmlUrl: string | null): Promise<void> {
    // Collect every analysis id referenced by any <caption source="…">.
    const referenced = new Set<string>();
    for (const seq of doc.sequences) {
      for (const scene of seq.scenes) {
        for (const shot of scene.shots) {
          for (const cap of shot.captions) {
            if (cap.source) referenced.add(cap.source);
          }
        }
      }
    }
    if (referenced.size === 0) return;

    const next = new Map(transcriptWords);
    for (const analysisId of referenced) {
      // Pre-loaded inline transcripts take priority over network fetch.
      if (transcripts[analysisId]) {
        next.set(analysisId, normaliseInlineWords(transcripts[analysisId] as any));
        continue;
      }
      const url = resolveAnalysisUrl(doc, analysisId, xmlUrl);
      if (!url) continue;
      try {
        const words = await loadTranscript(url);
        next.set(analysisId, words);
      } catch (err) {
        console.warn("[workbook-composition] transcript load failed", analysisId, err);
      }
    }
    transcriptWords = next;
  }

  function resolveAssetUrl(assetId: string): string | null {
    const a = assetIndex.get(assetId);
    if (!a) return null;
    if (baseUrl) {
      try {
        return new URL(a.src, new URL(baseUrl, window.location.href)).toString();
      } catch {
        return a.src;
      }
    }
    return a.src;
  }

  function assetKind(assetId: string): string {
    return assetIndex.get(assetId)?.kind ?? "";
  }

  // Audio mixer for <audio> cues. Created lazily on first activation
  // so SSR / non-audio compositions never instantiate an AudioContext.
  let audioMixer: AudioMixer | null = null;
  let mixerVolumeUnsub: (() => void) | null = null;
  let mixerAudioRelease: (() => void) | null = null;

  // GSAP timelines, one per shot. Built lazily when a shot first becomes
  // active. Driven by the playhead — pause/play/seek flow through here
  // so the runtime's transport controls the animations too.
  const shotTimelines = new Map<string, CompiledTimeline | null>();
  const shotTimelinesPending = new Set<string>();

  async function ensureShotTimeline(shot: ResolvedShot): Promise<CompiledTimeline | null> {
    if (shotTimelines.has(shot.id)) return shotTimelines.get(shot.id) ?? null;
    if (shotTimelinesPending.has(shot.id)) return null;
    shotTimelinesPending.add(shot.id);
    const el = containerEl?.querySelector(`[data-shot-id="${shot.id}"]`) as HTMLElement | null;
    if (!el) {
      shotTimelinesPending.delete(shot.id);
      return null;
    }
    const fps = timeline?.fps ?? 30;
    const tl = await compileShotTimeline(el, shot, fps);
    shotTimelines.set(shot.id, tl);
    shotTimelinesPending.delete(shot.id);
    return tl;
  }

  function findShot(shotId: string): ResolvedShot | null {
    if (!timeline) return null;
    for (const seq of timeline.sequences) {
      for (const scene of seq.scenes) {
        for (const shot of scene.shots) {
          if (shot.id === shotId) return shot;
        }
      }
    }
    return null;
  }

  // Drive GSAP off the playhead. Whenever the playhead or the active
  // shot changes, seek that shot's timeline to the shot-local time.
  $effect(() => {
    if (!isActive || !timeline || !activeShotId) return;
    const shot = findShot(activeShotId);
    if (!shot) return;
    const fps = timeline.fps;
    const localFrame = theater.playheadFrame - shot.startFrame;
    const localSeconds = Math.max(0, localFrame / fps);
    void ensureShotTimeline(shot).then((tl) => {
      if (!tl) return;
      tl.seek(localSeconds);
    });
    // Dispatch the legacy hf:ready event for HF HTML scenes that
    // attach their own GSAP timelines off this signal.
    const el = containerEl?.querySelector(`[data-shot-id="${activeShotId}"]`);
    el?.dispatchEvent(new CustomEvent("hf:ready", { bubbles: true, detail: { shotId: activeShotId } }));
  });

  // Drive the audio mixer off the playhead — keeps cue gains / fades
  // in sync regardless of whether playback is running or scrubbing.
  $effect(() => {
    if (!isActive || !timeline) return;
    if (!audioMixer && (timeline.audios?.length ?? 0) > 0) {
      audioMixer = new AudioMixer({ fps: timeline.fps, baseUrl });
      mixerVolumeUnsub = theater.subscribeVolume((v, muted) => {
        audioMixer?.setMasterVolume(v, muted);
      });
      // Initial volume sync — subscribeVolume only fires on change.
      audioMixer.setMasterVolume(theater.volume, theater.muted);
      // Register so the Theater volume slider shows even when there
      // are no <video> clips driving audio — pure <audio>-only
      // compositions still need the slider.
      mixerAudioRelease = theater.registerAudioSource();
    }
    if (!audioMixer) return;
    // Collect every active shot's cues and refresh the mixer's cue set.
    const cues = [];
    for (const seq of timeline.sequences) {
      for (const scene of seq.scenes) {
        for (const shot of scene.shots) cues.push(...shot.audios);
      }
    }
    void audioMixer.load(cues, timeline.audios ?? []);
    if (theater.playing) audioMixer.play();
    else audioMixer.pause();
    audioMixer.seek(theater.playheadFrame);
  });

  onMount(() => {
    untrack(() => {
      theater.registerComposition({
        id: compositionId,
        fps: 30,
        timeline: null,
      });
    });
    if (xml !== undefined) {
      void loadXmlFromText(xml, null);
    } else if (src) {
      void loadXml(src);
    } else {
      loadError = "<Composition> requires either `src` or `xml`";
    }
  });

  onDestroy(() => {
    theater.unregisterComposition(compositionId);
    for (const tl of shotTimelines.values()) tl?.destroy();
    shotTimelines.clear();
    mixerVolumeUnsub?.();
    mixerVolumeUnsub = null;
    mixerAudioRelease?.();
    mixerAudioRelease = null;
    audioMixer?.destroy();
    audioMixer = null;
  });

  function deriveIdFromSrc(s: string): string {
    const last = s.split(/[/\\]/).pop() ?? s;
    return last.replace(/\.[a-z]+$/i, "");
  }

  let __anonCounter = 0;
  function nextAnonId(): number {
    return ++__anonCounter;
  }

  function sceneHtmlFor(sceneCompositionRef: string | undefined | null): string | null {
    if (!sceneCompositionRef) return null;
    return sceneHtml.get(sceneCompositionRef) ?? null;
  }

  /**
   * Resolve an element's adjustment (by ref or inline filter) plus
   * any inline `style=` pass-through into a single CSS style string.
   * Returns undefined if nothing applies — Svelte then omits the
   * style attribute entirely.
   */
  function composeStyle(
    elStyle: string | undefined,
    filter: string | undefined,
    adjustmentRef: string | undefined,
  ): string | undefined {
    const parts: string[] = [];
    if (elStyle) parts.push(elStyle.replace(/;?\s*$/, ""));
    // Inline filter= wins over a named adjustment.
    const effectiveFilter = filter ?? (adjustmentRef ? lookupAdjustmentFilter(adjustmentRef) : undefined);
    if (effectiveFilter) parts.push(`filter:${effectiveFilter}`);
    if (adjustmentRef) {
      const adj = timeline?.adjustments?.find((a) => a.id === adjustmentRef);
      if (adj?.backdrop) parts.push(`backdrop-filter:${adj.backdrop}`);
      if (adj?.blend) parts.push(`mix-blend-mode:${adj.blend}`);
    }
    return parts.length > 0 ? parts.join(";") : undefined;
  }

  function lookupAdjustmentFilter(ref: string): string | undefined {
    return timeline?.adjustments?.find((a) => a.id === ref)?.filter;
  }

  function shotStyle(shot: ResolvedShot, active: boolean): string | undefined {
    // Shot-level: collect every <adjustment> child, plus the shot's
    // own style=. display:none for inactive shots is appended last.
    const parts: string[] = [];
    if (shot.style) parts.push(shot.style.replace(/;?\s*$/, ""));
    for (const a of shot.adjustments ?? []) {
      const f = a.filter ?? (a.ref ? lookupAdjustmentFilter(a.ref) : undefined);
      if (f) parts.push(`filter:${f}`);
      const decl = a.ref ? timeline?.adjustments?.find((d) => d.id === a.ref) : undefined;
      if (a.backdrop ?? decl?.backdrop) parts.push(`backdrop-filter:${a.backdrop ?? decl?.backdrop}`);
      if (a.blend ?? decl?.blend) parts.push(`mix-blend-mode:${a.blend ?? decl?.blend}`);
    }
    parts.push(`display:${active ? "block" : "none"}`);
    return parts.join(";");
  }
</script>

<div
  class={`workbook-composition ${className}`}
  data-composition-id={compositionId}
  data-active={isActive}
  bind:this={containerEl}
>
  {#if loadError}
    <pre class="workbook-composition-error">cw-xml load failed: {loadError}</pre>
  {:else if children}
    {@render children?.()}
  {:else if timeline}
    {#each timeline.sequences as seq (seq.id)}
      {#each seq.scenes as scene (scene.id)}
        <div
          class="workbook-composition-scene"
          data-scene-id={scene.id}
          data-active={activeSceneId === scene.id}
        >
          {#if sceneHtmlFor(scene.composition)}
            {@html sceneHtmlFor(scene.composition)}
          {/if}
          {#each scene.shots as shot (shot.id)}
            <div
              class={`workbook-composition-shot ${shot.class ?? ""}`}
              data-shot-id={shot.id}
              data-active={activeShotId === shot.id}
              style={shotStyle(shot, activeShotId === shot.id)}
            >
              {#each shot.clips as clip (clip.id)}
                {#if assetKind(clip.asset) === "video"}
                  <ClipVideo
                    src={resolveAssetUrl(clip.asset)}
                    clipId={clip.id}
                    fps={timeline.fps}
                    sourceInFrame={clip.sourceInFrame}
                    sourceOutFrame={clip.sourceOutFrame}
                    clipStartFrame={clip.startFrame}
                    clipEndFrame={clip.endFrame}
                    shotActive={activeShotId === shot.id}
                    class={clip.class ?? ""}
                    style={composeStyle(clip.style, clip.filter, clip.adjustment)}
                  />
                {:else if assetKind(clip.asset) === "image" || assetKind(clip.asset) === ""}
                  <img
                    class={`workbook-composition-clip workbook-composition-clip--image ${clip.class ?? ""}`}
                    src={resolveAssetUrl(clip.asset) ?? ""}
                    alt=""
                    data-clip-id={clip.id}
                    style={composeStyle(clip.style, clip.filter, clip.adjustment)}
                  />
                {/if}
              {/each}
              {#each shot.layers as layer (layer.id)}
                {#if layer.text}
                  <div
                    class={`workbook-composition-layer workbook-composition-layer--text ${layer.class ?? ""}`}
                    id={layer.id}
                    data-anim-subject={layer.id}
                    data-anchor={layer.anchor ?? ""}
                    data-role={layer.role ?? ""}
                    style={composeStyle(layer.style, layer.filter, layer.adjustment)}
                  >{layer.text}</div>
                {:else if layer.kind === "image" && layer.src}
                  <img
                    class={`workbook-composition-layer workbook-composition-layer--image ${layer.class ?? ""}`}
                    id={layer.id}
                    data-anim-subject={layer.id}
                    data-anchor={layer.anchor ?? ""}
                    data-role={layer.role ?? ""}
                    src={layer.src}
                    alt=""
                    style={composeStyle(layer.style, layer.filter, layer.adjustment)}
                  />
                {/if}
              {/each}
              {#each shot.captions as caption (caption.id)}
                {#if transcriptWords.get(caption.source)?.length}
                  <Captions
                    words={transcriptWords.get(caption.source) ?? []}
                    playheadFrame={theater.playheadFrame}
                    fps={timeline.fps}
                    mode={caption.mode ?? "word-highlight"}
                    anchor={caption.anchor ?? "lower-third"}
                    class={caption.class ?? ""}
                    style={caption.style ?? ""}
                  />
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      {/each}
    {/each}
  {/if}
</div>

<style>
  :global(.workbook-composition-error) {
    color: #ff8a8a;
    background: rgba(0, 0, 0, 0.6);
    padding: 16px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    margin: 0;
  }

  :global(.workbook-composition-shot) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  :global(.workbook-composition-clip) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  :global(.workbook-composition-clip--video) {
    background: #000;
  }

  :global(.workbook-composition-layer--text) {
    position: absolute;
    color: var(--wb-color-fg, #fff);
    font:
      var(--wb-font-headline-weight, 600)
      var(--wb-font-headline-size, 48px) /
      var(--wb-font-headline-line, 1.2)
      var(--wb-font-headline, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
    padding: 32px;
  }

  :global(.workbook-composition-layer--text[data-anchor="center"]) {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
  }

  :global(.workbook-composition-layer--text[data-anchor="lower-third"]) {
    left: 8%;
    right: 8%;
    bottom: 12%;
  }

  :global(.workbook-composition-layer--image) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    max-width: 60%;
    max-height: 60%;
  }
</style>
