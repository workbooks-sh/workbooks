// Theater context — shared API between <Theater> and child <Composition>
// components. Mirror of presentation/context.ts in shape; substitute
// "playhead in frames" for "current slide index".

import { getContext, setContext } from "svelte";
import type { ResolvedTimelineFlat } from "@work.books/cw-xml";

const THEATER_CONTEXT = Symbol("workbook-theater");

export interface CompositionHandle {
  id: string;
  fps: number;
  /** May be null while the XML is loading. */
  timeline: ResolvedTimelineFlat | null;
}

export type VolumeListener = (volume: number, muted: boolean) => void;

export interface TheaterApi {
  registerComposition(handle: CompositionHandle): void;
  updateComposition(id: string, handle: Partial<CompositionHandle>): void;
  unregisterComposition(id: string): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seekFrame(frame: number): void;
  seekSeconds(seconds: number): void;
  next(): void;
  previous(): void;
  selectComposition(id: string): void;
  /**
   * Clips with audio call this on mount; the returned function releases
   * the source. Theater surfaces the volume slider only while count > 0.
   */
  registerAudioSource(): () => void;
  /**
   * Subscribe to volume + mute changes. Listener is invoked
   * immediately with the current values so late subscribers stay in
   * sync. Returns an unsubscribe function.
   */
  subscribeVolume(fn: VolumeListener): () => void;
  readonly playing: boolean;
  readonly playheadFrame: number;
  readonly currentCompositionId: string | null;
  readonly currentComposition: CompositionHandle | null;
  readonly compositions: readonly CompositionHandle[];
  readonly volume: number;
  readonly muted: boolean;
}

export function setTheaterContext(api: TheaterApi): void {
  setContext(THEATER_CONTEXT, api);
}

export function getTheaterContext(): TheaterApi {
  const api = getContext<TheaterApi | undefined>(THEATER_CONTEXT);
  if (!api) {
    throw new Error("<Composition> must be used inside a <Theater> component.");
  }
  return api;
}
