<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { setPresentationContext } from "./context";
  import { PRESENTATION_LAYOUT_CSS } from "./layoutCss";

  // No `theme` prop. The runtime ALWAYS loads structural archetype
  // layout primitives (centered title/stat/quote/qa, 2-col comparison
  // grid, numbered process flow, demo-slide fallback z-index, etc.)
  // so `<Slide kind="…">` means something visually no matter what.
  //
  // Everything else — palette, typography, per-archetype flourishes,
  // voice — is the author's. Write it in your project's styles.css
  // and override the runtime's CSS-variable surface (--wb-color-*,
  // --wb-font-*, --wb-*-size). See the workbook-presentation skill's
  // references/designing-the-look.md for the variable surface + a
  // worked custom theme example.
  //
  // If you write no styles.css, your deck uses the var fallbacks and
  // looks like a wireframe. That's the correct failure mode — design
  // is part of authoring, not picked from a menu.

  let {
    aspectRatio = "16:9",
    title = null,
    showControls = true,
    children,
  }: {
    aspectRatio?: string | number;
    title?: string | null;
    showControls?: boolean;
    children?: import("svelte").Snippet;
  } = $props();

  let current = $state(0);
  let viewingBackup = $state(-1);
  let slides = $state<symbol[]>([]);
  let backupSlides = $state<symbol[]>([]);
  let printMode = $state(false);
  let viewportEl = $state<HTMLDivElement | null>(null);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);

  const ratio = $derived(parseAspectRatio(aspectRatio));
  const ratioCss = $derived(`${ratio.width} / ${ratio.height}`);
  const ratioValue = $derived(String(ratio.width / ratio.height));
  const canvas = $derived(canvasSize(ratio));
  const scale = $derived(computeScale(viewportWidth, viewportHeight, canvas));
  const progress = $derived(slides.length === 0 ? "0 / 0" : `${current + 1} / ${slides.length}`);

  function clamp(index: number): number {
    if (slides.length === 0) return 0;
    return Math.max(0, Math.min(slides.length - 1, index));
  }

  function goTo(index: number): void {
    viewingBackup = -1;
    current = clamp(index);
  }

  function goToBackup(index: number): void {
    if (backupSlides.length === 0) return;
    viewingBackup = Math.max(0, Math.min(backupSlides.length - 1, index));
  }

  function next(): void {
    goTo(current + 1);
  }

  function previous(): void {
    goTo(current - 1);
  }

  function register(id: symbol): number {
    const existing = slides.indexOf(id);
    if (existing !== -1) return existing;
    slides = [...slides, id];
    return slides.length - 1;
  }

  function unregister(id: symbol): void {
    const index = slides.indexOf(id);
    if (index === -1) return;
    slides = slides.filter((slide) => slide !== id);
    if (current >= slides.length) current = clamp(slides.length - 1);
  }

  function registerBackup(id: symbol): number {
    const existing = backupSlides.indexOf(id);
    if (existing !== -1) return existing;
    backupSlides = [...backupSlides, id];
    return backupSlides.length - 1;
  }

  function unregisterBackup(id: symbol): void {
    const index = backupSlides.indexOf(id);
    if (index === -1) return;
    backupSlides = backupSlides.filter((slide) => slide !== id);
  }

  function indexOf(id: symbol): number {
    const main = slides.indexOf(id);
    if (main !== -1) return main;
    return backupSlides.indexOf(id);
  }

  // Negative pseudo-indices distinguish "viewing backup slide N" from
  // "viewing main slide N" without a second predicate exposed to <Slide>.
  setPresentationContext({
    register,
    unregister,
    registerBackup,
    unregisterBackup,
    goTo,
    goToBackup,
    next,
    previous,
    indexOf,
    get current() {
      return viewingBackup === -1 ? current : -1 - viewingBackup;
    },
    get count() { return slides.length; },
    get backupCount() { return backupSlides.length; },
    get printMode() { return printMode; },
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;

    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      previous();
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(slides.length - 1);
    }
  }

  onMount(() => {
    printMode = window.matchMedia?.("print").matches ?? false;
    const media = window.matchMedia?.("print");
    const onPrint = (event: MediaQueryListEvent) => {
      printMode = event.matches;
    };
    media?.addEventListener?.("change", onPrint);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("beforeprint", () => (printMode = true));
    window.addEventListener("afterprint", () => (printMode = false));

    let observer: ResizeObserver | null = null;
    if (viewportEl && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const box = entry.contentRect;
        viewportWidth = box.width;
        viewportHeight = box.height;
      });
      observer.observe(viewportEl);
      const rect = viewportEl.getBoundingClientRect();
      viewportWidth = rect.width;
      viewportHeight = rect.height;
    }

    return () => {
      media?.removeEventListener?.("change", onPrint);
      window.removeEventListener("keydown", onKeydown);
      observer?.disconnect();
    };
  });

  onDestroy(() => {
    slides = [];
    backupSlides = [];
  });

  function parseAspectRatio(value: string | number): { width: number; height: number } {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return { width: value, height: 1 };
    }
    const raw = String(value).trim();
    const match = raw.match(/^(\d+(?:\.\d+)?)(?::|\/)(\d+(?:\.\d+)?)$/);
    if (!match) return { width: 16, height: 9 };
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { width: 16, height: 9 };
    }
    return { width, height };
  }

  // Fixed design canvas: author writes everything in absolute pixels at
  // these dimensions; the wrapper transform-scales to fit the viewport.
  // Common ratios get explicit sizes; everything else derives a canvas
  // around 1920x1080 area.
  function canvasSize(r: { width: number; height: number }): { width: number; height: number } {
    const aspect = r.width / r.height;
    if (Math.abs(aspect - 16 / 9) < 0.001) return { width: 1920, height: 1080 };
    if (Math.abs(aspect - 4 / 3) < 0.001) return { width: 1280, height: 960 };
    if (Math.abs(aspect - 21 / 9) < 0.01) return { width: 2520, height: 1080 };
    if (Math.abs(aspect - 9 / 16) < 0.001) return { width: 1080, height: 1920 };
    if (aspect >= 1) {
      return { width: 1920, height: Math.round(1920 / aspect) };
    }
    return { width: Math.round(1920 * aspect), height: 1920 };
  }

  function computeScale(
    w: number,
    h: number,
    c: { width: number; height: number },
  ): number {
    if (w <= 0 || h <= 0) return 1;
    return Math.min(w / c.width, h / c.height);
  }
</script>

<svelte:head>
  {@html `<style data-wb-presentation-layout>${PRESENTATION_LAYOUT_CSS}</style>`}
</svelte:head>

<div
  class="workbook-presentation"
  class:print-mode={printMode}
  style:--wbp-aspect={ratioCss}
  style:--wbp-ratio={ratioValue}
  style:--wbp-canvas-w="{canvas.width}px"
  style:--wbp-canvas-h="{canvas.height}px"
  data-workbook-presentation
>
  {#if showControls}
    <div class="workbook-presentation-controls" data-print-hidden>
      <div class="workbook-presentation-title">{title ?? ""}</div>
      <div class="workbook-presentation-actions">
        <button type="button" onclick={previous} disabled={current === 0} aria-label="Previous slide">‹</button>
        <span>{progress}</span>
        <button type="button" onclick={next} disabled={current >= slides.length - 1} aria-label="Next slide">›</button>
      </div>
    </div>
  {/if}

  <div class="workbook-presentation-viewport" bind:this={viewportEl}>
    <div
      class="workbook-presentation-fit"
      style:width="{canvas.width * scale}px"
      style:height="{canvas.height * scale}px"
    >
      <div
        class="workbook-presentation-stage"
        style:transform={printMode ? "none" : `scale(${scale})`}
      >
        {@render children?.()}
      </div>
    </div>
  </div>
</div>

<style>
  :global(.workbook-presentation) {
    --wbp-bg: #101014;
    --wbp-panel: rgba(255, 255, 255, 0.08);
    --wbp-panel-border: rgba(255, 255, 255, 0.16);
    --wbp-fg: #f7f7f7;
    --wbp-muted: rgba(247, 247, 247, 0.68);
    min-height: 100vh;
    background: var(--wbp-bg);
    color: var(--wbp-fg);
    display: grid;
    grid-template-rows: auto 1fr;
  }

  :global(.workbook-presentation-controls) {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 12px;
    font: 500 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--wbp-muted);
  }

  :global(.workbook-presentation-title) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.workbook-presentation-actions) {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
  }

  :global(.workbook-presentation-actions button) {
    width: 32px;
    height: 32px;
    border: 1px solid var(--wbp-panel-border);
    border-radius: 999px;
    background: var(--wbp-panel);
    color: var(--wbp-fg);
    font: inherit;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  :global(.workbook-presentation-actions button:disabled) {
    opacity: 0.35;
    cursor: default;
  }

  :global(.workbook-presentation-viewport) {
    width: 100%;
    min-width: 0;
    min-height: 0;
    height: calc(100vh - 48px);
    display: grid;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    overflow: hidden;
  }

  :global(.workbook-presentation-fit) {
    position: relative;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
    background: var(--wb-color-bg, #fff);
  }

  :global(.workbook-presentation-stage) {
    position: relative;
    width: var(--wbp-canvas-w);
    height: var(--wbp-canvas-h);
    transform-origin: top left;
    overflow: hidden;
    background: var(--wb-color-bg, #fff);
    color: var(--wb-color-text, #111);
  }

  :global(.wb-slide) {
    position: absolute;
    inset: 0;
    display: none;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }

  :global(.wb-slide.active) {
    display: block;
  }

  :global(.wb-slide-inner) {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }

  :global(.workbook-presentation.print-mode) {
    display: block;
    min-height: auto;
    background: #fff;
    color: #111;
  }

  :global(.workbook-presentation.print-mode [data-print-hidden]) {
    display: none;
  }

  :global(.workbook-presentation.print-mode .workbook-presentation-viewport) {
    display: block;
    height: auto;
    padding: 0;
    overflow: visible;
  }

  :global(.workbook-presentation.print-mode .workbook-presentation-fit) {
    width: 100% !important;
    height: auto !important;
    box-shadow: none;
  }

  :global(.workbook-presentation.print-mode .workbook-presentation-stage) {
    width: 100%;
    height: auto;
    max-height: none;
    overflow: visible;
    transform: none !important;
    aspect-ratio: var(--wbp-aspect);
  }

  :global(.workbook-presentation.print-mode .wb-slide) {
    position: relative;
    display: block;
    aspect-ratio: var(--wbp-aspect);
    break-after: page;
    page-break-after: always;
  }

  @media print {
    :global(.workbook-presentation) {
      display: block;
      min-height: auto;
      background: #fff;
      color: #111;
    }

    :global(.workbook-presentation [data-print-hidden]) {
      display: none;
    }

    :global(.workbook-presentation-viewport) {
      display: block;
      height: auto;
      padding: 0;
      overflow: visible;
    }

    :global(.workbook-presentation-fit) {
      width: 100% !important;
      height: auto !important;
      box-shadow: none;
    }

    :global(.workbook-presentation-stage) {
      width: 100%;
      height: auto;
      max-height: none;
      overflow: visible;
      transform: none !important;
      aspect-ratio: var(--wbp-aspect);
    }

    :global(.wb-slide) {
      position: relative;
      display: block;
      aspect-ratio: var(--wbp-aspect);
      break-after: page;
      page-break-after: always;
    }
  }
</style>
