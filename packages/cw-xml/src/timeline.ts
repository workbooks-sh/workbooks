// Walks the IR and produces absolute-frame positions for every
// sequence / scene / shot / clip / layer / animation / transition.
// Mirrors the Rust `timeline.rs` resolver. The player consumes the
// flat `entries` projection for "what's on screen at frame N?" lookups.

import { parseTime } from "./time";
import {
  CwXmlError,
  type Animation,
  type AudioCue,
  type Clip,
  type CwXmlDocument,
  type Fps,
  type FrameTime,
  type Layer,
  type Resolution,
  type ResolvedAnimation,
  type ResolvedAudioCue,
  type ResolvedCaption,
  type ResolvedClip,
  type ResolvedConstraint,
  type ResolvedLayer,
  type ResolvedScene,
  type ResolvedSequence,
  type ResolvedShot,
  type ResolvedTimeline,
  type ResolvedTimelineFlat,
  type ResolvedTransition,
  type Scene,
  type Sequence,
  type Shot,
  type TimelineEntry,
  type Transition,
} from "./types";

/** Parse a JSON object string from a CW XML attr. Bad JSON → undefined. */
function parseVarsAttr(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through — tolerate bad input so a typo doesn't kill the timeline
  }
  return undefined;
}

export function resolveTimeline(doc: CwXmlDocument): ResolvedTimelineFlat {
  if (doc.fps === undefined) {
    throw new CwXmlError("cw-xml requires fps on the root element");
  }
  if (doc.resolution === undefined) {
    throw new CwXmlError("cw-xml requires resolution on the root element");
  }
  if (doc.aspect === undefined) {
    throw new CwXmlError("cw-xml requires aspect on the root element");
  }
  const fps = doc.fps;
  const resolution: Resolution = doc.resolution;
  const aspect = doc.aspect;

  let cursor = 0;
  const sequences: ResolvedSequence[] = [];
  for (const seq of doc.sequences) {
    const duration = requiredFrames(seq.duration, fps, `sequence '${seq.id}'`);
    const start = cursor;
    const resolved = resolveSequence(seq, fps, start);
    sequences.push(resolved);
    cursor = start + duration.frames;
  }

  const entries = flattenEntries(sequences);
  return {
    fps,
    resolution,
    aspect,
    duration: { frames: cursor },
    sequences,
    entries,
    audios: doc.audios,
    adjustments: doc.adjustments,
  };
}

function resolveSequence(seq: Sequence, fps: Fps, start: number): ResolvedSequence {
  const duration = requiredFrames(seq.duration, fps, `sequence '${seq.id}'`);
  let cursor = start;
  const scenes: ResolvedScene[] = [];
  for (const scene of seq.scenes) {
    const resolved = resolveScene(scene, fps, cursor);
    scenes.push(resolved);
    cursor = resolved.endFrame;
  }
  return {
    id: seq.id,
    startFrame: start,
    endFrame: start + duration.frames,
    scenes,
  };
}

function resolveScene(scene: Scene, fps: Fps, start: number): ResolvedScene {
  const duration = requiredFrames(scene.duration, fps, `scene '${scene.id}'`);
  let cursor = start;
  const shots: ResolvedShot[] = [];
  for (const shot of scene.shots) {
    const resolved = resolveShot(shot, fps, cursor);
    shots.push(resolved);
    cursor = resolved.endFrame;
  }
  return {
    id: scene.id,
    composition: scene.composition,
    startFrame: start,
    endFrame: start + duration.frames,
    shots,
  };
}

function resolveShot(shot: Shot, fps: Fps, start: number): ResolvedShot {
  const duration = requiredFrames(shot.duration, fps, `shot '${shot.id}'`);
  const endFrame = start + duration.frames;

  const clips: ResolvedClip[] = shot.clips.map((clip) => resolveClip(clip, fps, start, duration));
  const layers: ResolvedLayer[] = shot.layers.map((layer) => resolveLayer(layer, fps, start, duration));

  const captions: ResolvedCaption[] = shot.captions.map((c) => ({
    id: c.id,
    source: c.source,
    mode: c.mode,
    anchor: c.anchor,
    safe: c.safe,
    class: c.class,
    style: c.style,
  }));

  const constraints: ResolvedConstraint[] = shot.constraints.map((c) => ({
    id: c.id,
    kind: c.kind,
    target: c.target,
    value: c.value,
  }));

  const animations: ResolvedAnimation[] = shot.animations.map((a) =>
    resolveAnimation(a, fps, start),
  );

  const transitions: ResolvedTransition[] = shot.transitions.map((t) =>
    resolveTransition(t, fps, start, endFrame),
  );

  const audios: ResolvedAudioCue[] = shot.audios.map((a) =>
    resolveAudioCue(a, fps, start, duration),
  );

  return {
    id: shot.id,
    composition: shot.composition,
    class: shot.class,
    style: shot.style,
    startFrame: start,
    endFrame,
    clips,
    layers,
    captions,
    constraints,
    animations,
    transitions,
    audios,
    adjustments: shot.adjustments,
  };
}

function resolveClip(clip: Clip, fps: Fps, shotStart: number, shotDuration: FrameTime): ResolvedClip {
  const sourceIn = optionalFrames(clip.in, fps)?.frames ?? 0;
  const sourceOut = optionalFrames(clip.out, fps)?.frames ?? sourceIn + shotDuration.frames;
  const startOffset = optionalFrames(clip.start, fps)?.frames ?? 0;
  const clipDuration = optionalFrames(clip.duration, fps)?.frames ?? sourceOut - sourceIn;
  return {
    id: clip.id,
    asset: clip.asset,
    sourceInFrame: sourceIn,
    sourceOutFrame: sourceOut,
    startFrame: shotStart + startOffset,
    endFrame: shotStart + startOffset + clipDuration,
    class: clip.class,
    style: clip.style,
    filter: clip.filter,
    adjustment: clip.adjustment,
  };
}

function resolveLayer(layer: Layer, fps: Fps, shotStart: number, shotDuration: FrameTime): ResolvedLayer {
  const startOffset = optionalFrames(layer.start, fps)?.frames ?? 0;
  const layerDuration = optionalFrames(layer.duration, fps)?.frames ?? shotDuration.frames;
  return {
    id: layer.id,
    kind: layer.kind,
    role: layer.role,
    anchor: layer.anchor,
    safe: layer.safe,
    src: layer.src,
    text: layer.text,
    startFrame: shotStart + startOffset,
    endFrame: shotStart + startOffset + layerDuration,
    class: layer.class,
    style: layer.style,
    filter: layer.filter,
    adjustment: layer.adjustment,
  };
}

function resolveAnimation(anim: Animation, fps: Fps, shotStart: number): ResolvedAnimation {
  const startOffset = optionalFrames(anim.start, fps)?.frames ?? 0;
  const duration = requiredFrames(anim.duration, fps, `animation '${anim.id}'`);
  // `vars=` is a shorthand for either `from=` or `to=` depending on phase.
  const fromAttr = anim.from ?? (anim.phase !== "out" ? anim.vars : undefined);
  const toAttr = anim.to ?? (anim.phase === "out" ? anim.vars : undefined);
  return {
    id: anim.id,
    intent: anim.intent,
    subject: anim.subject,
    direction: anim.direction,
    principle: anim.principle,
    easing: anim.easing,
    fromVars: parseVarsAttr(fromAttr),
    toVars: parseVarsAttr(toAttr),
    phase: anim.phase,
    class: anim.class,
    style: anim.style,
    startFrame: shotStart + startOffset,
    endFrame: shotStart + startOffset + duration.frames,
  };
}

function resolveTransition(t: Transition, fps: Fps, shotStart: number, shotEnd: number): ResolvedTransition {
  const duration = requiredFrames(t.duration, fps, `transition (${t.phase})`);
  const start = t.phase === "in" ? shotStart : shotEnd - duration.frames;
  const end = t.phase === "in" ? shotStart + duration.frames : shotEnd;
  return {
    phase: t.phase,
    kind: t.kind,
    direction: t.direction,
    easing: t.easing,
    fromVars: parseVarsAttr(t.from),
    toVars: parseVarsAttr(t.to),
    class: t.class,
    style: t.style,
    startFrame: start,
    endFrame: end,
  };
}

function resolveAudioCue(
  cue: AudioCue,
  fps: Fps,
  shotStart: number,
  shotDuration: FrameTime,
): ResolvedAudioCue {
  const startOffset = optionalFrames(cue.start, fps)?.frames ?? 0;
  const cueDuration = optionalFrames(cue.duration, fps)?.frames ?? shotDuration.frames;
  return {
    ref: cue.ref,
    startFrame: shotStart + startOffset,
    endFrame: shotStart + startOffset + cueDuration,
    volume: cue.volume,
    duck: cue.duck,
    fadeIn: cue.fadeIn,
    fadeOut: cue.fadeOut,
    pan: cue.pan,
  };
}

function requiredFrames(value: string | undefined, fps: Fps, label: string): FrameTime {
  if (value === undefined || value.length === 0) {
    throw new CwXmlError(`${label}: duration is required`);
  }
  return parseTime(value, fps);
}

function optionalFrames(value: string | undefined, fps: Fps): FrameTime | undefined {
  if (value === undefined) return undefined;
  return parseTime(value, fps);
}

function flattenEntries(sequences: ResolvedSequence[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const seq of sequences) {
    out.push({
      id: seq.id,
      startFrame: seq.startFrame,
      endFrame: seq.endFrame,
      source: "sequence",
    });
    for (const scene of seq.scenes) {
      out.push({
        id: scene.id,
        startFrame: scene.startFrame,
        endFrame: scene.endFrame,
        source: "scene",
        composition: scene.composition,
      });
      for (const shot of scene.shots) {
        out.push({
          id: shot.id,
          startFrame: shot.startFrame,
          endFrame: shot.endFrame,
          source: "shot",
          composition: shot.composition,
        });
      }
    }
  }
  return out;
}

/**
 * Returns the smallest set of entries currently active at `frame`,
 * sorted from broadest to narrowest (sequence → scene → shot). The
 * player mounts HF HTML based on the most-specific composition string
 * that's currently active.
 */
export function entriesAtFrame(timeline: ResolvedTimelineFlat, frame: number): TimelineEntry[] {
  return timeline.entries.filter((e) => frame >= e.startFrame && frame < e.endFrame);
}
