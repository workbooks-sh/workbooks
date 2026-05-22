<script lang="ts">
  // Renders the active caption for one shot. State derives from the
  // playhead frame — no internal timer — so pausing and scrubbing
  // Just Work via the existing transport. See `captions.ts` for the
  // loader + frame lookup.
  //
  // The mode/anchor inputs are free strings. Canonical shorthands
  // (mode=word-highlight|line, anchor=lower-third|center|upper-third)
  // get default CSS via :global rules below. Any other value renders
  // as a `data-mode` / `data-anchor` token the author can style with
  // their own CSS — or override entirely via `class=` / `style=`.

  import { wordsAtFrame, type AudioWord } from "./captions";

  let {
    words,
    playheadFrame,
    fps,
    mode = "word-highlight",
    anchor = "lower-third",
    class: className = "",
    style = "",
  }: {
    words: AudioWord[];
    playheadFrame: number;
    fps: number;
    mode?: string;
    anchor?: string;
    class?: string;
    style?: string;
  } = $props();

  const state = $derived(wordsAtFrame(words, playheadFrame, fps, mode));
</script>

{#if state.visibleWords.length > 0}
  <div
    class={`workbook-caption ${className}`}
    data-anchor={anchor}
    data-mode={mode}
    style={style || undefined}
  >
    <span class="workbook-caption-line">
      {#each state.visibleWords as w, i (i)}
        <span
          class="workbook-caption-word"
          data-active={i === state.activeIndex}
        >{w.text}</span>{i < state.visibleWords.length - 1 ? " " : ""}
      {/each}
    </span>
  </div>
{/if}

<style>
  :global(.workbook-caption) {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - var(--wb-caption-safe-padding, 80px) * 2);
    padding: var(--wb-caption-padding-y, 12px) var(--wb-caption-padding-x, 24px);
    background: var(--wb-color-caption-bg, rgba(0, 0, 0, 0.6));
    color: var(--wb-color-caption-text, #fff);
    font:
      var(--wb-font-caption-weight, 500)
      var(--wb-font-caption-size, 32px) /
      var(--wb-font-caption-line, 1.3)
      var(--wb-font-caption, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    text-align: center;
    border-radius: var(--wb-caption-radius, 6px);
    pointer-events: none;
  }

  :global(.workbook-caption[data-anchor="lower-third"]) {
    bottom: var(--wb-caption-safe-padding, 80px);
  }

  :global(.workbook-caption[data-anchor="upper-third"]) {
    top: var(--wb-caption-safe-padding, 80px);
  }

  :global(.workbook-caption[data-anchor="center"]) {
    top: 50%;
    transform: translate(-50%, -50%);
  }

  :global(.workbook-caption-word) {
    transition: color 120ms ease-out, opacity 120ms ease-out;
    opacity: 0.7;
  }

  :global(.workbook-caption[data-mode="line"] .workbook-caption-word) {
    opacity: 1;
  }

  :global(.workbook-caption-word[data-active="true"]) {
    color: var(--wb-color-caption-active, var(--wb-color-accent, #ffd84a));
    opacity: 1;
  }
</style>
