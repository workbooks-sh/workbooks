/**
 * Composition SDK — `<Theater>` + `<Composition>` for video-shaped
 * workbooks. Theater is the workbook-level wrapper (chrome + transport
 * + composition picker). Composition is one CW XML video. Multiple
 * compositions live inside one Theater.
 *
 * Workbooks ship as type:"spa" with manifest.compositions[] — this is
 * not a new workbook shape. See packages/workbooks/skills/workbook-video.
 *
 * Render-to-MP4 is not wired here; the "Render" button shows "coming
 * soon" until the WebCodecs path lands. Drive the browser-side player
 * with Space/Arrow keys; screen-record for now if a video file is
 * needed.
 */

export { default as Theater } from "./Theater.svelte";
export { default as Composition } from "./Composition.svelte";
export { default as ClipVideo } from "./ClipVideo.svelte";
export {
  getTheaterContext,
  setTheaterContext,
  type TheaterApi,
  type CompositionHandle,
  type VolumeListener,
} from "./context";
export {
  compileShotTimeline,
  type CompiledTimeline,
} from "./gsapRunner";
export { default as Captions } from "./Captions.svelte";
export {
  compileTransition,
  isNoOpTransition,
  type TransitionKind,
  type CompiledTransition,
} from "./transitions";
export {
  loadTranscript,
  injectTranscript,
  resolveAnalysisUrl,
  parseJson as parseTranscriptJson,
  parseVtt as parseTranscriptVtt,
  wordsAtFrame,
  type AudioWord,
  type AudioSegment,
  type CaptionFrameState,
} from "./captions";
