import { mount } from "svelte";
import * as Y from "yjs";
import StagePane from "./StagePane.svelte";
import type { StageConfig } from "./types";

// The runtime's state module routes Yjs through yjsHost (single-instance
// gate against the duplicate-yjs bundler hazard). The stage is the
// outermost host of its own bundle — there's no parent app to set the
// global — so we set it ourselves before state.ts gets touched.
if (typeof globalThis !== "undefined" && !(globalThis as { __wb_yjs?: unknown }).__wb_yjs) {
  (globalThis as { __wb_yjs?: unknown }).__wb_yjs = Y;
}

function readStage(): { config: StageConfig; slug: string } {
  const el = document.getElementById("workbook-spec");
  if (!el || el.tagName !== "SCRIPT") {
    throw new Error("stage: workbook-spec script tag not found");
  }
  const spec = JSON.parse(el.textContent ?? "{}");
  // Read manifest.stage first (canonical), fall back to manifest.playground
  // for artifacts built before the stage rename. New code should always
  // write manifest.stage with type:"spa".
  // shape-drift-ok: legacy manifest.playground back-compat lookup.
  const cfg = spec?.manifest?.stage ?? spec?.manifest?.playground;
  if (!cfg || typeof cfg.wraps !== "string") {
    throw new Error(
      "stage: manifest.stage missing — workbook.config.mjs must declare a stage block with a wraps target on a type:'spa' workbook",
    );
  }
  const slug = typeof spec?.manifest?.slug === "string" ? spec.manifest.slug : "default";
  return {
    slug,
    config: {
      wraps: cfg.wraps,
      panels: {
        left: cfg.panels?.left ?? null,
        right: cfg.panels?.right ?? null,
        bottom: cfg.panels?.bottom ?? null,
      },
    },
  };
}

/**
 * Mount the stage UI for the canonical case: panels render from
 * `config.panels` (built-in "chat" / "effects" / "terminal" / null
 * options), wrapped iframe loads from `config.wraps`.
 *
 * For workbooks that need CUSTOM panel content (e.g., a chat with a
 * specific system prompt, a terminal piped to a non-default source),
 * skip mountStage and use StagePane directly as a Svelte component in
 * your own .svelte entry. Pass snippets via the `left` / `right` /
 * `bottom` props:
 *
 *   <StagePane {config} {slug}>
 *     {#snippet right(cfg)}
 *       <MyCustomChatPanel ...attrs />
 *     {/snippet}
 *   </StagePane>
 *
 * Snippets are Svelte 5 template constructs — they can't be passed
 * from plain JS, which is why mountStage doesn't accept them as a
 * second arg. Author-side wrapping in .svelte is the canonical
 * escape hatch.
 */
export function mountStage(target: HTMLElement): void {
  const { config, slug } = readStage();
  mount(StagePane, { target, props: { config, slug } });
}

/** @deprecated Use mountStage. Kept for one release for back-compat with
 *  artifacts built before the stage rename. */
export const mountPlayground = mountStage;
