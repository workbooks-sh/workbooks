<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getPresentationContext } from "./context";
  import type { SlideKind } from "./kinds";

  let {
    kind = "content",
    interactive = false,
    fallback,
    class: className = "",
    children,
  }: {
    kind?: SlideKind;
    interactive?: boolean;
    fallback?: string;
    class?: string;
    children?: import("svelte").Snippet;
  } = $props();

  const api = getPresentationContext();
  const id = Symbol("workbook-slide");
  let index = $state(-1);
  let backupIndex = $state(-1);
  const isBackup = $derived(kind === "backup");
  const active = $derived(
    api.printMode ||
    (isBackup ? api.current === -1 - backupIndex : api.current === index),
  );

  const fallbackIsVideo = $derived(
    typeof fallback === "string" && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(fallback),
  );

  onMount(() => {
    if (isBackup) {
      backupIndex = api.registerBackup(id);
    } else {
      index = api.register(id);
    }
  });

  onDestroy(() => {
    if (isBackup) {
      api.unregisterBackup(id);
    } else {
      api.unregister(id);
    }
  });
</script>

<section
  class={`workbook-slide wb-slide wb-slide--${kind} ${interactive ? "wb-slide--interactive" : ""} ${className}`}
  class:active
  data-slide-index={isBackup ? backupIndex : index}
  data-slide-kind={kind}
  data-slide-backup={isBackup ? "" : undefined}
  aria-hidden={!active}
>
  {#if kind === "demo" && fallback}
    {#if fallbackIsVideo}
      <video class="wb-slide-fallback" src={fallback} autoplay muted loop playsinline></video>
    {:else}
      <img class="wb-slide-fallback" src={fallback} alt="" />
    {/if}
  {/if}

  {#if kind === "comparison"}
    <div class="workbook-slide-inner wb-slide-inner">
      <div class="wb-slide-grid">
        {@render children?.()}
      </div>
    </div>
  {:else if kind === "process"}
    <div class="workbook-slide-inner wb-slide-inner">
      <div class="wb-slide-flow">
        {@render children?.()}
      </div>
    </div>
  {:else}
    <div class="workbook-slide-inner wb-slide-inner">
      {@render children?.()}
    </div>
  {/if}
</section>
