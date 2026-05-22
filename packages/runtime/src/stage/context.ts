/**
 * Svelte context key for the stage Y.doc handle. Panel components
 * (effects, chat, terminal) read this to access shared state. The
 * holder is a mutable wrapper because the doc lifecycle is tied to the
 * iframe mount/unmount, not to the StagePane component lifetime.
 */

import { getContext } from "svelte";
import type { StageDocHandle } from "./state";

export const STAGE_DOC_CONTEXT = Symbol("wb-stage-doc");

/** @deprecated Use STAGE_DOC_CONTEXT. Kept as an alias for one release. */
export const PLAYGROUND_DOC_CONTEXT = STAGE_DOC_CONTEXT;

export interface StageDocHolder {
  current: StageDocHandle | undefined;
}

/** @deprecated Use StageDocHolder. */
export type PlaygroundDocHolder = StageDocHolder;

export function getStageDoc(): StageDocHolder | undefined {
  return getContext<StageDocHolder>(STAGE_DOC_CONTEXT);
}

/** @deprecated Use getStageDoc. */
export const getPlaygroundDoc = getStageDoc;
