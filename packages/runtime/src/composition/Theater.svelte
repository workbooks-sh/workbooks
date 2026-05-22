<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { setTheaterContext, type CompositionHandle, type TheaterApi } from "./context";
  import { createTransport, type Transport } from "./transport";

  // No `theme` prop. The runtime always renders a structural player
  // chrome (transport, scrub, clock, volume, fullscreen, composition
  // picker). Palette / type / accent live in the author's styles.css
  // and override the runtime's CSS-variable surface (--wb-color-bg,
  // --wb-color-fg, --wb-color-muted, --wb-color-accent, --wb-font-ui).
  // No styles.css → wireframe fallbacks. Design is part of authoring.

  let {
    title = null,
    class: className = "",
    children,
    controls,
  }: {
    title?: string | null;
    class?: string;
    children?: import("svelte").Snippet;
    /**
     * Optional snippet that replaces the default chrome bar entirely.
     * Receives the full TheaterApi so author UI can drive every
     * transport / scrub / volume / fullscreen action. When omitted,
     * the runtime renders its default monochromatic chrome.
     *
     * Use this when the agent has authored a bespoke player UI in the
     * workbook (e.g. for a brand-matched player) — see
     * `references/cw-xml.md` for the full snippet contract.
     */
    controls?: import("svelte").Snippet<[TheaterApi & {
      playing: boolean;
      playheadFrame: number;
      durationFrames: number;
      durationSeconds: number;
      currentSeconds: number;
      scrubProgress: number;
      volume: number;
      muted: boolean;
      isFullscreen: boolean;
      audioSourceCount: number;
      fps: number;
    }]>;
  } = $props();

  // 1920x1080 design canvas to match the presentation runtime. Compositions
  // author at this resolution; the wrapper transform-scales to fit.
  const CANVAS_W = 1920;
  const CANVAS_H = 1080;

  let compositions = $state<CompositionHandle[]>([]);
  let currentCompositionId = $state<string | null>(null);
  let playheadFrame = $state(0);
  let playing = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let viewportEl = $state<HTMLDivElement | null>(null);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);

  // Audio surface — clips register/unregister volume control here.
  let audioSourceCount = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  const volumeListeners = new Set<(v: number, m: boolean) => void>();

  // Scrub-bar hover preview
  let scrubEl = $state<HTMLDivElement | null>(null);
  let hoverPreview = $state<{ visible: boolean; x: number; time: number }>(
    { visible: false, x: 0, time: 0 },
  );

  let isFullscreen = $state(false);

  const currentComposition = $derived(
    compositions.find((c) => c.id === currentCompositionId) ?? null,
  );
  const scale = $derived(computeScale(viewportWidth, viewportHeight));
  const durationFrames = $derived(currentComposition?.timeline?.duration.frames ?? 0);
  const fps = $derived(currentComposition?.fps ?? 30);
  const durationSeconds = $derived(
    currentComposition && currentComposition.timeline ? durationFrames / fps : 0,
  );
  const currentSeconds = $derived(
    currentComposition && currentComposition.timeline ? playheadFrame / fps : 0,
  );
  const scrubProgress = $derived(
    durationFrames > 0 ? Math.min(1, playheadFrame / Math.max(1, durationFrames - 1)) : 0,
  );

  let transport: Transport | null = null;

  function ensureTransport(): Transport {
    if (transport) return transport;
    transport = createTransport({
      fps: currentComposition?.fps ?? 30,
      getDurationFrames: () => durationFrames,
      onTick: (f) => {
        playheadFrame = f;
      },
      onEnd: () => {
        playing = false;
      },
    });
    return transport;
  }

  function rebuildTransportForCurrent(): void {
    transport?.destroy();
    transport = null;
    playheadFrame = 0;
    playing = false;
    ensureTransport();
  }

  function selectComposition(id: string): void {
    if (id === currentCompositionId) return;
    currentCompositionId = id;
    rebuildTransportForCurrent();
  }

  function nextComposition(): void {
    if (compositions.length === 0) return;
    const idx = currentCompositionId
      ? compositions.findIndex((c) => c.id === currentCompositionId)
      : -1;
    const nextIdx = Math.min(compositions.length - 1, idx + 1);
    if (compositions[nextIdx]) selectComposition(compositions[nextIdx].id);
  }

  function previousComposition(): void {
    if (compositions.length === 0) return;
    const idx = currentCompositionId
      ? compositions.findIndex((c) => c.id === currentCompositionId)
      : 0;
    const prevIdx = Math.max(0, idx - 1);
    if (compositions[prevIdx]) selectComposition(compositions[prevIdx].id);
  }

  function notifyVolume(): void {
    for (const fn of volumeListeners) fn(volume, muted);
  }

  const api: TheaterApi = {
    registerComposition(handle) {
      const existing = compositions.findIndex((c) => c.id === handle.id);
      if (existing >= 0) {
        compositions[existing] = handle;
        compositions = [...compositions];
      } else {
        compositions = [...compositions, handle];
      }
      if (currentCompositionId === null) {
        currentCompositionId = handle.id;
        rebuildTransportForCurrent();
      } else if (currentCompositionId === handle.id) {
        if (handle.timeline) transport?.setFps(handle.fps);
      }
    },
    updateComposition(id, patch) {
      const idx = compositions.findIndex((c) => c.id === id);
      if (idx < 0) return;
      const next = { ...compositions[idx], ...patch };
      compositions[idx] = next;
      compositions = [...compositions];
      if (id === currentCompositionId && patch.timeline) {
        transport?.setFps(next.fps);
      }
    },
    unregisterComposition(id) {
      compositions = compositions.filter((c) => c.id !== id);
      if (currentCompositionId === id) {
        currentCompositionId = compositions[0]?.id ?? null;
        rebuildTransportForCurrent();
      }
    },
    play() {
      ensureTransport().play();
      playing = true;
    },
    pause() {
      transport?.pause();
      playing = false;
    },
    toggle() {
      if (playing) api.pause();
      else api.play();
    },
    seekFrame(f) {
      ensureTransport().seek(f);
    },
    seekSeconds(s) {
      ensureTransport().seek(Math.round(s * (currentComposition?.fps ?? 30)));
    },
    next() {
      ensureTransport().seek(playheadFrame + (currentComposition?.fps ?? 30));
    },
    previous() {
      ensureTransport().seek(playheadFrame - (currentComposition?.fps ?? 30));
    },
    selectComposition,
    registerAudioSource() {
      audioSourceCount += 1;
      return () => {
        audioSourceCount = Math.max(0, audioSourceCount - 1);
      };
    },
    subscribeVolume(fn) {
      volumeListeners.add(fn);
      fn(volume, muted);
      return () => {
        volumeListeners.delete(fn);
      };
    },
    get playing() { return playing; },
    get playheadFrame() { return playheadFrame; },
    get currentCompositionId() { return currentCompositionId; },
    get currentComposition() { return currentComposition; },
    get compositions() { return compositions; },
    get volume() { return volume; },
    get muted() { return muted; },
  };

  setTheaterContext(api);

  function onScrubPointer(event: PointerEvent): void {
    if (!scrubEl) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    seekFromPointer(event);
    const move = (ev: PointerEvent) => seekFromPointer(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function seekFromPointer(event: PointerEvent): void {
    if (!scrubEl || durationFrames <= 0) return;
    const rect = scrubEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    api.seekFrame(Math.round(ratio * (durationFrames - 1)));
  }

  function onScrubHover(event: PointerEvent): void {
    if (!scrubEl || durationFrames <= 0) return;
    const rect = scrubEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    hoverPreview = {
      visible: true,
      x: ratio * rect.width,
      time: ratio * durationSeconds,
    };
  }

  function onScrubLeave(): void {
    hoverPreview = { ...hoverPreview, visible: false };
  }

  function onVolumeInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    volume = Math.max(0, Math.min(1, v));
    if (volume > 0) muted = false;
    notifyVolume();
  }

  function toggleMute(): void {
    muted = !muted;
    notifyVolume();
  }

  async function toggleFullscreen(): Promise<void> {
    if (!rootEl) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await rootEl.requestFullscreen();
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;

    switch (event.key) {
      case " ":
      case "k":
        event.preventDefault();
        api.toggle();
        break;
      case "ArrowRight":
      case "l":
        event.preventDefault();
        api.next();
        break;
      case "ArrowLeft":
      case "j":
        event.preventDefault();
        api.previous();
        break;
      case "[":
        event.preventDefault();
        previousComposition();
        break;
      case "]":
        event.preventDefault();
        nextComposition();
        break;
      case "Home":
        event.preventDefault();
        api.seekFrame(0);
        break;
      case "End":
        event.preventDefault();
        api.seekFrame(Math.max(0, durationFrames - 1));
        break;
      case "f":
        event.preventDefault();
        void toggleFullscreen();
        break;
      case "m":
        event.preventDefault();
        toggleMute();
        break;
    }
  }

  function onFullscreenChange(): void {
    isFullscreen = document.fullscreenElement === rootEl;
  }

  function computeScale(w: number, h: number): number {
    if (w <= 0 || h <= 0) return 1;
    return Math.min(w / CANVAS_W, h / CANVAS_H);
  }

  function formatTimecode(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const totalMs = Math.floor(sec * 1000);
    const m = Math.floor(totalMs / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const cs = Math.floor((totalMs % 1000) / 10);
    return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
  }

  onMount(() => {
    window.addEventListener("keydown", onKeydown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    let observer: ResizeObserver | null = null;
    if (viewportEl && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        viewportWidth = entry.contentRect.width;
        viewportHeight = entry.contentRect.height;
      });
      observer.observe(viewportEl);
      const rect = viewportEl.getBoundingClientRect();
      viewportWidth = rect.width;
      viewportHeight = rect.height;
    }
    return () => {
      window.removeEventListener("keydown", onKeydown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      observer?.disconnect();
    };
  });

  onDestroy(() => {
    transport?.destroy();
  });
</script>

<div class={`workbook-theater ${className}`} bind:this={rootEl}>
  <div class="workbook-theater-viewport" bind:this={viewportEl}>
    <div
      class="workbook-theater-fit"
      style:width="{CANVAS_W * scale}px"
      style:height="{CANVAS_H * scale}px"
    >
      <div
        class="workbook-theater-stage"
        style:width="{CANVAS_W}px"
        style:height="{CANVAS_H}px"
        style:transform="scale({scale})"
      >
        {@render children?.()}
      </div>
    </div>
  </div>

  {#if controls}
    {@render controls?.({
      ...api,
      playing,
      playheadFrame,
      durationFrames,
      durationSeconds,
      currentSeconds,
      scrubProgress,
      volume,
      muted,
      isFullscreen,
      audioSourceCount,
      fps,
    })}
  {:else}
  <div class="workbook-theater-chrome" data-print-hidden>
    {#if title}
      <div class="workbook-theater-title">{title}</div>
    {/if}

    <button
      type="button"
      class="workbook-theater-play"
      onclick={() => api.toggle()}
      aria-label={playing ? "Pause" : "Play"}
    >
      {#if playing}
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" fill="currentColor" />
          <rect x="14" y="5" width="4" height="14" fill="currentColor" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M7 4 L20 12 L7 20 Z" fill="currentColor" />
        </svg>
      {/if}
    </button>

    <div
      class="workbook-theater-scrub"
      bind:this={scrubEl}
      role="slider"
      tabindex="0"
      aria-valuemin="0"
      aria-valuemax={Math.max(0, durationFrames - 1)}
      aria-valuenow={playheadFrame}
      aria-label="Scrub timeline"
      onpointerdown={onScrubPointer}
      onpointermove={onScrubHover}
      onpointerleave={onScrubLeave}
    >
      <div class="workbook-theater-scrub-track">
        <div
          class="workbook-theater-scrub-fill"
          style:width="{scrubProgress * 100}%"
        ></div>
        <div
          class="workbook-theater-scrub-thumb"
          style:left="{scrubProgress * 100}%"
        ></div>
      </div>
      {#if hoverPreview.visible}
        <div
          class="workbook-theater-scrub-preview"
          style:left="{hoverPreview.x}px"
        >{formatTimecode(hoverPreview.time)}</div>
      {/if}
    </div>

    <span class="workbook-theater-clock" aria-label="Playhead position">
      {formatTimecode(currentSeconds)} / {formatTimecode(durationSeconds)}
    </span>

    {#if audioSourceCount > 0}
      <div class="workbook-theater-volume">
        <button
          type="button"
          class="workbook-theater-icon-btn"
          onclick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {#if muted || volume === 0}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M4 9 L4 15 L8 15 L13 19 L13 5 L8 9 Z" fill="currentColor" />
              <path d="M17 9 L22 14 M22 9 L17 14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M4 9 L4 15 L8 15 L13 19 L13 5 L8 9 Z" fill="currentColor" />
              <path d="M16 8 Q19 12 16 16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
            </svg>
          {/if}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          oninput={onVolumeInput}
          aria-label="Volume"
        />
      </div>
    {/if}

    {#if compositions.length > 1}
      <select
        class="workbook-theater-picker"
        aria-label="Composition"
        value={currentCompositionId ?? ""}
        onchange={(e) => selectComposition((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each compositions as comp (comp.id)}
          <option value={comp.id}>{comp.id}</option>
        {/each}
      </select>
    {/if}

    <button
      type="button"
      class="workbook-theater-icon-btn"
      onclick={() => void toggleFullscreen()}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      {#if isFullscreen}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M9 3 L9 9 L3 9 M15 3 L15 9 L21 9 M9 21 L9 15 L3 15 M15 21 L15 15 L21 15" stroke="currentColor" stroke-width="2" fill="none" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M3 9 L3 3 L9 3 M21 9 L21 3 L15 3 M3 15 L3 21 L9 21 M21 15 L21 21 L15 21" stroke="currentColor" stroke-width="2" fill="none" />
        </svg>
      {/if}
    </button>
  </div>
  {/if}
</div>

<style>
  :global(.workbook-theater) {
    --wbt-bg: var(--wb-color-bg, #0a0a0c);
    --wbt-fg: var(--wb-color-fg, #f7f7f7);
    --wbt-muted: var(--wb-color-muted, rgba(247, 247, 247, 0.62));
    --wbt-accent: var(--wb-color-accent, #f59e0b);
    --wbt-chrome-bg: var(--wb-color-chrome-bg, rgba(10, 10, 12, 0.88));
    --wbt-chrome-border: var(--wb-color-chrome-border, rgba(255, 255, 255, 0.12));
    --wbt-chrome-control: var(--wb-color-chrome-control, rgba(255, 255, 255, 0.08));
    --wbt-font-ui: var(--wb-font-ui, 500 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    --wbt-chrome-h: 56px;

    min-height: 100vh;
    background: var(--wbt-bg);
    color: var(--wbt-fg);
    display: grid;
    grid-template-rows: 1fr auto;
    position: relative;
  }

  :global(.workbook-theater:fullscreen) {
    min-height: 100vh;
  }

  :global(.workbook-theater-viewport) {
    width: 100%;
    height: calc(100vh - var(--wbt-chrome-h));
    display: grid;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    overflow: hidden;
  }

  :global(.workbook-theater:fullscreen .workbook-theater-viewport) {
    height: calc(100vh - var(--wbt-chrome-h));
  }

  :global(.workbook-theater-fit) {
    position: relative;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
    background: #000;
    overflow: hidden;
  }

  :global(.workbook-theater-stage) {
    position: relative;
    transform-origin: top left;
    background: #000;
    overflow: hidden;
  }

  :global(.workbook-theater-chrome) {
    display: grid;
    grid-template-columns: auto auto 1fr auto auto auto auto;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    min-height: var(--wbt-chrome-h);
    font: var(--wbt-font-ui);
    color: var(--wbt-muted);
    background: var(--wbt-chrome-bg);
    border-top: 1px solid var(--wbt-chrome-border);
  }

  :global(.workbook-theater-title) {
    grid-column: 1;
    min-width: 0;
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--wbt-fg);
    padding-right: 4px;
    border-right: 1px solid var(--wbt-chrome-border);
    margin-right: 6px;
  }

  :global(.workbook-theater-play) {
    grid-column: 2;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border: 1px solid var(--wbt-chrome-border);
    border-radius: 999px;
    background: var(--wbt-chrome-control);
    color: var(--wbt-fg);
    cursor: pointer;
    padding: 0;
  }

  :global(.workbook-theater-play:hover) {
    background: var(--wbt-accent);
    color: var(--wbt-bg);
    border-color: var(--wbt-accent);
  }

  :global(.workbook-theater-scrub) {
    grid-column: 3;
    position: relative;
    height: 24px;
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }

  :global(.workbook-theater-scrub-track) {
    position: relative;
    width: 100%;
    height: 4px;
    background: var(--wbt-chrome-control);
    border-radius: 2px;
  }

  :global(.workbook-theater-scrub:hover .workbook-theater-scrub-track) {
    height: 6px;
  }

  :global(.workbook-theater-scrub-fill) {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--wbt-accent);
    border-radius: 2px;
  }

  :global(.workbook-theater-scrub-thumb) {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    background: var(--wbt-accent);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  :global(.workbook-theater-scrub:hover .workbook-theater-scrub-thumb) {
    opacity: 1;
  }

  :global(.workbook-theater-scrub-preview) {
    position: absolute;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    padding: 4px 8px;
    background: var(--wbt-bg);
    color: var(--wbt-fg);
    border: 1px solid var(--wbt-chrome-border);
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }

  :global(.workbook-theater-clock) {
    grid-column: 4;
    font-variant-numeric: tabular-nums;
    color: var(--wbt-fg);
    min-width: 14ch;
    text-align: right;
  }

  :global(.workbook-theater-volume) {
    grid-column: 5;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  :global(.workbook-theater-volume input[type="range"]) {
    width: 80px;
    accent-color: var(--wbt-accent);
  }

  :global(.workbook-theater-picker) {
    grid-column: 6;
    background: var(--wbt-chrome-control);
    color: var(--wbt-fg);
    border: 1px solid var(--wbt-chrome-border);
    border-radius: 6px;
    padding: 6px 10px;
    font: inherit;
  }

  :global(.workbook-theater-icon-btn) {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--wbt-chrome-border);
    border-radius: 6px;
    background: var(--wbt-chrome-control);
    color: var(--wbt-fg);
    cursor: pointer;
    padding: 0;
  }

  :global(.workbook-theater-icon-btn:hover) {
    background: var(--wbt-accent);
    color: var(--wbt-bg);
    border-color: var(--wbt-accent);
  }

  :global(.workbook-composition) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  :global(.workbook-composition[data-active="false"]) {
    display: none;
  }

  :global(.workbook-composition-scene) {
    position: absolute;
    inset: 0;
    display: none;
    width: 100%;
    height: 100%;
  }

  :global(.workbook-composition-scene[data-active="true"]) {
    display: block;
  }
</style>
