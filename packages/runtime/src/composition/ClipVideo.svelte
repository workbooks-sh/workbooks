<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getTheaterContext } from "./context";

  let {
    src,
    clipId,
    fps,
    sourceInFrame,
    sourceOutFrame,
    clipStartFrame,
    clipEndFrame,
    shotActive,
    class: className = "",
    style = "",
  }: {
    src: string | null;
    clipId: string;
    fps: number;
    sourceInFrame: number;
    sourceOutFrame: number;
    clipStartFrame: number;
    clipEndFrame: number;
    shotActive: boolean;
    class?: string;
    style?: string;
  } = $props();

  const theater = getTheaterContext();
  let videoEl = $state<HTMLVideoElement | null>(null);
  let audioReleased: (() => void) | null = null;
  let volumeUnsub: (() => void) | null = null;
  let registeredAudio = false;
  let lastAppliedSeconds = -1;

  // The clip is in-range when the shot is active AND the playhead sits
  // inside the clip's absolute frame range. Outside the range we pause
  // and release the audio source so the volume slider hides when the
  // last clip-with-audio exits.
  const inRange = $derived(
    shotActive &&
      theater.playheadFrame >= clipStartFrame &&
      theater.playheadFrame < clipEndFrame,
  );

  const targetSourceSeconds = $derived(
    (sourceInFrame + (theater.playheadFrame - clipStartFrame)) / Math.max(1, fps),
  );

  function registerAudioOnce(): void {
    if (registeredAudio) return;
    registeredAudio = true;
    audioReleased = theater.registerAudioSource();
    volumeUnsub = theater.subscribeVolume((v, muted) => {
      if (!videoEl) return;
      videoEl.volume = muted ? 0 : v;
      videoEl.muted = muted;
    });
  }

  function releaseAudio(): void {
    audioReleased?.();
    audioReleased = null;
    volumeUnsub?.();
    volumeUnsub = null;
    registeredAudio = false;
  }

  $effect(() => {
    const el = videoEl;
    if (!el) return;
    if (!inRange) {
      if (!el.paused) el.pause();
      return;
    }
    const target = targetSourceSeconds;
    // Always pin the playhead when paused / scrubbing. When playing,
    // only correct drift > ~80ms — letting the video drive its own
    // currentTime is smoother than rewriting it every rAF tick.
    if (!theater.playing) {
      if (Math.abs(target - lastAppliedSeconds) > 1 / fps) {
        el.currentTime = target;
        lastAppliedSeconds = target;
      }
      if (!el.paused) el.pause();
    } else {
      if (el.paused) {
        el.currentTime = target;
        lastAppliedSeconds = target;
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => undefined);
      } else if (Math.abs(el.currentTime - target) > 0.08) {
        el.currentTime = target;
        lastAppliedSeconds = target;
      }
    }
  });

  function onLoadedMetadata(): void {
    if (!videoEl) return;
    // Heuristic: assume every <video> can carry audio. If the file
    // ends up being silent the slider still shows but is harmless.
    registerAudioOnce();
  }

  onMount(() => {
    if (videoEl) {
      videoEl.muted = theater.muted;
      videoEl.volume = theater.muted ? 0 : theater.volume;
    }
  });

  onDestroy(() => {
    releaseAudio();
  });
</script>

{#if src}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    class={`workbook-composition-clip workbook-composition-clip--video ${className}`}
    data-clip-id={clipId}
    src={src}
    preload="auto"
    playsinline
    style={style || undefined}
    onloadedmetadata={onLoadedMetadata}
  ></video>
{/if}
