<script lang="ts">
  import type { Snippet } from "svelte";
  import { setContext, onDestroy } from "svelte";
  import type { StageConfig, PanelSide } from "./types";
  import { createStageDoc, type StageDocHandle } from "./state";
  import { STAGE_DOC_CONTEXT } from "./context";
  import EffectsPanel from "./EffectsPanel.svelte";

  let {
    config,
    slug = "default",
    left,
    right,
    bottom,
  }: {
    config: StageConfig;
    slug?: string;
    left?: Snippet<[StageConfig]>;
    right?: Snippet<[StageConfig]>;
    bottom?: Snippet<[StageConfig]>;
  } = $props();

  const STORAGE_PREFIX = "wb.playground.panel";
  const DEFAULT_SIZES: Record<PanelSide, number> = { left: 280, right: 320, bottom: 200 };
  const MIN_SIZE = 160;
  const MAX_SIZE = 800;
  // Collapsed rail width — just enough for the toggle arrow + padding.
  const COLLAPSED_SIZE = 28;

  function storageKey(side: PanelSide) {
    return `${STORAGE_PREFIX}.${side}`;
  }
  function loadOpen(side: PanelSide): boolean {
    if (config.panels[side] === null) return false;
    let saved: string | null = null;
    try { saved = localStorage.getItem(`${storageKey(side)}.open`); } catch { /* sandboxed iframe */ }
    return saved === null ? true : saved === "1";
  }
  function loadSize(side: PanelSide): number {
    let saved: string | null = null;
    try { saved = localStorage.getItem(`${storageKey(side)}.size`); } catch { /* sandboxed iframe */ }
    const n = saved ? Number.parseInt(saved, 10) : NaN;
    if (!Number.isFinite(n)) return DEFAULT_SIZES[side];
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
  }
  function persistOpen(side: PanelSide, value: boolean) {
    try { localStorage.setItem(`${storageKey(side)}.open`, value ? "1" : "0"); } catch { /* sandboxed iframe */ }
  }
  function persistSize(side: PanelSide, value: number) {
    try { localStorage.setItem(`${storageKey(side)}.size`, String(Math.round(value))); } catch { /* sandboxed iframe */ }
  }

  let leftOpen = $state(loadOpen("left"));
  let rightOpen = $state(loadOpen("right"));
  let bottomOpen = $state(loadOpen("bottom"));
  let leftSize = $state(loadSize("left"));
  let rightSize = $state(loadSize("right"));
  let bottomSize = $state(loadSize("bottom"));

  $effect(() => persistOpen("left", leftOpen));
  $effect(() => persistOpen("right", rightOpen));
  $effect(() => persistOpen("bottom", bottomOpen));
  $effect(() => persistSize("left", leftSize));
  $effect(() => persistSize("right", rightSize));
  $effect(() => persistSize("bottom", bottomSize));

  const wrappedSrc = $derived.by(() => {
    const w = config.wraps;
    if (/^https?:\/\//i.test(w) || w.startsWith("/")) return w;
    return `./${w.endsWith(".html") ? w : `${w}.html`}`;
  });

  /* Build-time embed: when the CLI baked the wrapped workbook into
   * this playground via <script id="wb-wrapped">, decode it once
   * and render the iframe via `srcdoc`. Eliminates the cross-
   * origin auth chain that bites `src=https://workbooks.sh/...`.
   * When the script is absent (older builds, or `wraps` couldn't
   * be fetched at build time), `wrappedSrcdoc` stays null and the
   * iframe falls back to `src={wrappedSrc}`. See wb-22u.18. */
  let wrappedSrcdoc = $state<string | null>(null);
  let wrappedSrcdocChecked = $state(false);

  async function loadEmbeddedWrapped(): Promise<string | null> {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("wb-wrapped");
    if (!el || el.tagName !== "SCRIPT") return null;
    const fmt = el.getAttribute("data-format") ?? "";
    if (fmt !== "html+gzip+base64") return null;
    const b64 = (el.textContent ?? "").trim();
    if (!b64) return null;
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const stream = new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      );
      return await stream.text();
    } catch (err) {
      console.warn("[stage] wb-wrapped decode failed:", err);
      return null;
    }
  }

  $effect(() => {
    if (wrappedSrcdocChecked) return;
    wrappedSrcdocChecked = true;
    void loadEmbeddedWrapped().then((html) => {
      wrappedSrcdoc = html;
    });
  });

  function toggle(side: PanelSide) {
    if (side === "left") leftOpen = !leftOpen;
    else if (side === "right") rightOpen = !rightOpen;
    else bottomOpen = !bottomOpen;
  }

  function startResize(side: PanelSide, e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = side === "left" ? leftSize : side === "right" ? rightSize : bottomSize;
    const move = (ev: PointerEvent) => {
      let next = startSize;
      if (side === "left") next = startSize + (ev.clientX - startX);
      else if (side === "right") next = startSize + (startX - ev.clientX);
      else next = startSize + (startY - ev.clientY);
      next = Math.max(MIN_SIZE, Math.min(MAX_SIZE, next));
      if (side === "left") leftSize = next;
      else if (side === "right") rightSize = next;
      else bottomSize = next;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  let iframeEl: HTMLIFrameElement | undefined = $state();
  let docHandle: StageDocHandle | undefined;
  const docHolder: { current: StageDocHandle | undefined } = { current: undefined };
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
</script>

<div class="playground">
  <div class="row">
    {#if config.panels.left !== null}
      <aside
        class="panel side left"
        class:is-open={leftOpen}
        style:width={leftOpen ? `${leftSize}px` : `${COLLAPSED_SIZE}px`}
      >
        <button
          class="panel-toggle panel-toggle-side panel-toggle-left"
          class:is-open={leftOpen}
          onclick={() => toggle("left")}
          aria-label={leftOpen ? "Hide left panel" : "Show left panel"}
          title={leftOpen ? "Hide left panel" : "Show left panel"}
        >‹</button>
        {#if leftOpen}
          <div class="panel-body">
            {#if left}{@render left(config)}
            {:else if config.panels.left === "effects"}<EffectsPanel {wrappedSrc} iframe={iframeEl} />
            {:else}<p class="panel-placeholder">{config.panels.left} panel</p>{/if}
          </div>
          <div
            class="resize-handle resize-side"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
            onpointerdown={(e) => startResize("left", e)}
          ></div>
        {/if}
      </aside>
    {/if}

    <main class="canvas">
      <!-- Single iframe element with derived src/srcdoc. Svelte
           collapses both attribute branches into ONE compiled
           <iframe> string template, so the iframe-invariant check
           (workbook-cli/checks/iframeInvariant.mjs) counts +1 not +2.
           Pre-collapse this file emitted two iframe template literals
           via {#if}/{:else}, both ending up in the compiled bundle —
           which broke default `workbook init --template=playground`
           builds with +1 over the allowance. wb-5q4a. -->
      <iframe
        bind:this={iframeEl}
        title="wrapped workbook"
        src={wrappedSrcdoc === null ? wrappedSrc : undefined}
        srcdoc={wrappedSrcdoc !== null ? wrappedSrcdoc : undefined}
        sandbox="allow-scripts allow-same-origin allow-forms"
      ></iframe>
    </main>

    {#if config.panels.right !== null}
      <aside
        class="panel side right"
        class:is-open={rightOpen}
        style:width={rightOpen ? `${rightSize}px` : `${COLLAPSED_SIZE}px`}
      >
        <button
          class="panel-toggle panel-toggle-side panel-toggle-right"
          class:is-open={rightOpen}
          onclick={() => toggle("right")}
          aria-label={rightOpen ? "Hide right panel" : "Show right panel"}
          title={rightOpen ? "Hide right panel" : "Show right panel"}
        >‹</button>
        {#if rightOpen}
          <div
            class="resize-handle resize-side"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            onpointerdown={(e) => startResize("right", e)}
          ></div>
          <div class="panel-body">
            {#if right}{@render right(config)}
            {:else if config.panels.right === "effects"}<EffectsPanel {wrappedSrc} iframe={iframeEl} />
            {:else}<p class="panel-placeholder">{config.panels.right} panel</p>{/if}
          </div>
        {/if}
      </aside>
    {/if}
  </div>

  {#if config.panels.bottom !== null}
    <aside
      class="panel bottom"
      class:is-open={bottomOpen}
      style:height={bottomOpen ? `${bottomSize}px` : `${COLLAPSED_SIZE}px`}
    >
      <button
        class="panel-toggle panel-toggle-bottom"
        class:is-open={bottomOpen}
        onclick={() => toggle("bottom")}
        aria-label={bottomOpen ? "Hide bottom panel" : "Show bottom panel"}
        title={bottomOpen ? "Hide bottom panel" : "Show bottom panel"}
      >‹</button>
      {#if bottomOpen}
        <div
          class="resize-handle resize-bottom"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize bottom panel"
          onpointerdown={(e) => startResize("bottom", e)}
        ></div>
        <div class="panel-body">
          {#if bottom}{@render bottom(config)}
          {:else if config.panels.bottom === "effects"}<EffectsPanel {wrappedSrc} iframe={iframeEl} />
          {:else}<p class="panel-placeholder">{config.panels.bottom} panel</p>{/if}
        </div>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .playground {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    padding: var(--pg-margin, 14px);
    box-sizing: border-box;
    gap: var(--pg-margin, 14px);
  }
  .row {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: var(--pg-margin, 14px);
  }
  .canvas {
    position: relative;
    flex: 1;
    min-width: 0;
    border-radius: var(--pg-radius, 12px);
    overflow: hidden;
    background: var(--pg-panel-bg, #141414);
    border: 1px solid var(--pg-border, rgba(255,255,255,0.08));
  }
  .canvas iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  .panel {
    position: relative;
    background: var(--pg-panel-bg, #141414);
    border: 1px solid var(--pg-border, rgba(255,255,255,0.08));
    border-radius: var(--pg-radius, 12px);
    transition: width 160ms ease, height 160ms ease;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .panel.side { height: 100%; }
  .panel.bottom {
    width: 100%;
    transition: height 160ms ease;
  }
  .panel-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: auto;
    padding: 12px;
    box-sizing: border-box;
  }
  .panel.side { display: flex; align-items: stretch; }
  .panel.bottom { display: flex; flex-direction: column; align-items: stretch; }
  .panel-placeholder {
    opacity: 0.5;
    font-size: 12px;
    margin: 0;
  }

  /* Panel toggle — lives inside the panel's edge so it never overlaps
   * the canvas. When the panel is collapsed, the panel shrinks to a
   * thin rail (COLLAPSED_SIZE) containing just the toggle. When open,
   * the toggle stays on the panel's canvas-facing edge. The arrow
   * rotates via transform to indicate direction. */
  .panel-toggle {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    align-self: center;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    border: 0;
    cursor: pointer;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: transform 160ms ease, color 120ms ease;
  }
  .panel-toggle:hover { color: rgba(255, 255, 255, 1); }
  /* Left panel: toggle on the right edge (canvas-facing). Arrow
   * points right when collapsed (open me), left when open (close me). */
  .panel-toggle-left { order: 2; }
  .panel-toggle-left:not(.is-open) { transform: rotate(180deg); }
  /* Right panel: toggle on the left edge. Arrow points left when
   * collapsed (open me — pointing into the panel area), right when open. */
  .panel-toggle-right { order: 0; }
  .panel-toggle-right.is-open { transform: rotate(180deg); }
  /* Bottom panel: toggle centered on the top edge. Arrow points up
   * when collapsed, down when open. */
  .panel-toggle-bottom {
    align-self: center;
    transform: rotate(90deg);
  }
  .panel-toggle-bottom.is-open {
    transform: rotate(-90deg);
  }

  /* Resize handles — drag along the panel's adjoining edge to size it.
   * The handle is a thin invisible strip with cursor:ew-resize/ns-resize
   * that the user can grab. */
  .resize-handle {
    position: absolute;
    z-index: 4;
    background: transparent;
  }
  .resize-handle:hover { background: var(--pg-border-strong, rgba(255,255,255,0.16)); }
  .resize-side {
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .panel.side.left > .resize-side { right: -3px; }
  .panel.side.right > .resize-side { left: -3px; }
  .resize-bottom {
    left: 0;
    right: 0;
    height: 6px;
    top: -3px;
    cursor: ns-resize;
  }
</style>
