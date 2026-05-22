/**
 * Svelte context surface for the declarative `<Stage>` component.
 * Mirrors `presentation/context.ts` so descendants can reach into the
 * stage's iframe bridge without prop-drilling.
 */

import { getContext, setContext } from "svelte";
import type { PanelSlot } from "./types";

export const STAGE_CONTEXT = Symbol("workbook-stage");

export interface StageApi {
  readonly currentWraps: string;
  readonly currentPanels: {
    left: PanelSlot;
    right: PanelSlot;
    bottom: PanelSlot;
  };
  sendToWrapped(message: unknown): void;
  onMessageFromWrapped(cb: (message: unknown) => void): () => void;
}

export function setStageContext(api: StageApi): void {
  setContext(STAGE_CONTEXT, api);
}

export function getStageContext(): StageApi {
  const api = getContext<StageApi | undefined>(STAGE_CONTEXT);
  if (!api) {
    throw new Error("getStageContext() must be called inside a <Stage> component.");
  }
  return api;
}
