/**
 * Stage SDK — wrapper workbook that hosts another workbook in a
 * sandboxed iframe with toggleable L/R/B panels. Reads its layout +
 * wrapped-workbook reference from `manifest.stage` in the
 * workbook-spec script. Panel content (effects / chat / terminal) plugs
 * into named slots; v1 ships empty slot placeholders, downstream tickets
 * (auto-generated effects panel, agent panel) fill them.
 *
 * Y.doc state substrate (this package): the stage host owns a
 * canonical Y.Doc that propagates to the wrapped workbook over
 * postMessage. Wrapped workbooks opt-in by importing `connectToStage`
 * from `@work.books/runtime/stage/client`.
 */

// Canonical declarative component.
export { default as Stage } from "./Stage.svelte";
// Imperative-mount target (what mountStage actually instantiates).
export { default as StagePane } from "./StagePane.svelte";
/** @deprecated Use StagePane (the imperative mount target) or Stage
 *  (the declarative component). */
export { default as Playground } from "./StagePane.svelte";
export { default as EffectsPanel } from "./EffectsPanel.svelte";
export { mountStage, mountPlayground } from "./mount";
export {
  createStageDoc,
  createPlaygroundDoc,
  type StageDocHandle,
  type PlaygroundDocHandle,
} from "./state";
export {
  connectToStage,
  connectToPlayground,
  type StageClientHandle,
  type PlaygroundClientHandle,
} from "./client";
export { installStageClient, installPlaygroundClient } from "./autowire";
export {
  getStageDoc,
  getPlaygroundDoc,
  STAGE_DOC_CONTEXT,
  PLAYGROUND_DOC_CONTEXT,
  type StageDocHolder,
  type PlaygroundDocHolder,
} from "./context";
export { getStageContext, setStageContext, STAGE_CONTEXT } from "./stageContext";
export type { StageApi } from "./stageContext";
export type { StageConfig, PlaygroundConfig, PanelSlot, PanelSide } from "./types";
