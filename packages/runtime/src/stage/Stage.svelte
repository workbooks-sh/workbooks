<script lang="ts">
  import type { Snippet } from "svelte";
  import { onDestroy, setContext } from "svelte";
  import type { PanelSlot } from "./types";
  import { createStageDoc, type StageDocHandle } from "./state";
  import { STAGE_DOC_CONTEXT, type StageDocHolder } from "./context";
  import { setStageContext, type StageApi } from "./stageContext";
  import EffectsPanel from "./EffectsPanel.svelte";

  type LeftRightSlot = Extract<PanelSlot, "effects" | "chat" | null>;
  type BottomSlot = Extract<PanelSlot, "terminal" | null>;

  let {
    wraps,
    panels = { left: null, right: null, bottom: null },
    srcDoc,
    slug = "stage",
    class: className = "",
    left,
    right,
    bottom,
    chat,
    terminal,
  }: {
    wraps: string;
    panels?: { left?: LeftRightSlot; right?: LeftRightSlot; bottom?: BottomSlot };
    srcDoc?: string;
    slug?: string;
    class?: string;
    left?: Snippet;
    right?: Snippet;
    bottom?: Snippet;
    chat?: Snippet;
    terminal?: Snippet;
  } = $props();

  const resolvedPanels = $derived({
    left: (panels.left ?? null) as LeftRightSlot,
    right: (panels.right ?? null) as LeftRightSlot,
    bottom: (panels.bottom ?? null) as BottomSlot,
  });

  const wrappedSrc = $derived.by(() => {
    if (/^https?:\/\//i.test(wraps) || wraps.startsWith("/") || wraps.startsWith("data:")) return wraps;
    return `./${wraps.endsWith(".html") ? wraps : `${wraps}.html`}`;
  });

  let iframeEl: HTMLIFrameElement | undefined = $state();
  let docHandle: StageDocHandle | undefined;
  const docHolder: StageDocHolder = { current: undefined };
  setContext(STAGE_DOC_CONTEXT, docHolder);

  $effect(() => {
    if (!iframeEl) return;
    docHandle = createStageDoc(slug, iframeEl);
    docHolder.current = docHandle;
    return () => {
      docHandle?.destroy();
      docHandle = undefined;
      docHolder.current = undefined;
    };
  });

  onDestroy(() => docHandle?.destroy());

  const messageListeners = new Set<(msg: unknown) => void>();

  function onWindowMessage(ev: MessageEvent) {
    if (!iframeEl || ev.source !== iframeEl.contentWindow) return;
    for (const cb of messageListeners) cb(ev.data);
  }

  $effect(() => {
    window.addEventListener("message", onWindowMessage);
    return () => window.removeEventListener("message", onWindowMessage);
  });

  const stageApi: StageApi = {
    get currentWraps() { return wraps; },
    get currentPanels() { return resolvedPanels; },
    sendToWrapped(message: unknown) {
      iframeEl?.contentWindow?.postMessage(message, "*");
    },
    onMessageFromWrapped(cb) {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
  };
  setStageContext(stageApi);
</script>

<div class={`wb-stage ${className}`.trim()}>
  {#if resolvedPanels.left !== null}
    <aside class="wb-stage__panel-left">
      {#if left}{@render left()}
      {:else if resolvedPanels.left === "effects"}<EffectsPanel {wrappedSrc} iframe={iframeEl} />
      {:else if resolvedPanels.left === "chat" && chat}{@render chat()}
      {/if}
    </aside>
  {/if}

  <main class="wb-stage__main">
    {#if srcDoc !== undefined}
      <iframe
        bind:this={iframeEl}
        class="wb-stage__iframe"
        title="stage wrapped workbook"
        srcdoc={srcDoc}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
    {:else}
      <iframe
        bind:this={iframeEl}
        class="wb-stage__iframe"
        title="stage wrapped workbook"
        src={wrappedSrc}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
    {/if}
  </main>

  {#if resolvedPanels.right !== null}
    <aside class="wb-stage__panel-right">
      {#if right}{@render right()}
      {:else if resolvedPanels.right === "effects"}<EffectsPanel {wrappedSrc} iframe={iframeEl} />
      {:else if resolvedPanels.right === "chat" && chat}{@render chat()}
      {/if}
    </aside>
  {/if}

  {#if resolvedPanels.bottom !== null}
    <aside class="wb-stage__panel-bottom">
      {#if bottom}{@render bottom()}
      {:else if resolvedPanels.bottom === "terminal" && terminal}{@render terminal()}
      {/if}
    </aside>
  {/if}
</div>

<style>
  .wb-stage {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: 1fr auto;
    grid-template-areas:
      "left main right"
      "bottom bottom bottom";
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
  .wb-stage__main {
    grid-area: main;
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .wb-stage__iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  .wb-stage__panel-left { grid-area: left; min-height: 0; overflow: auto; }
  .wb-stage__panel-right { grid-area: right; min-height: 0; overflow: auto; }
  .wb-stage__panel-bottom { grid-area: bottom; min-width: 0; overflow: auto; }
</style>
