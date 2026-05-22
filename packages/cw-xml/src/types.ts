// IR types mirror the Rust `cw-xml` crate's `ir.rs` and `timeline.rs`.
// Names follow TS convention (camelCase) but the underlying shape is
// 1:1 with the Rust structs so a future XML-from-the-editor flow can
// transfer either direction without translation.

export type Fps = number;

export interface FrameTime {
  readonly frames: number;
}

export interface Resolution {
  readonly width: number;
  readonly height: number;
}

/**
 * Pass-through visual attributes carried by every renderable element.
 * The parser preserves whatever the author wrote; the runtime applies
 * `class` as a class token and `style` as inline CSS on the rendered
 * DOM node. Lets agents attach arbitrary styling without escaping to
 * raw HF HTML.
 */
export interface VisualAttrs {
  /** Space-separated CSS class tokens added to the rendered DOM node. */
  class?: string;
  /** Inline CSS pushed onto the rendered DOM node's `style` attribute. */
  style?: string;
}

export interface CwXmlDocument {
  version?: string;
  fps?: Fps;
  resolution?: Resolution;
  aspect?: string;
  assets: Asset[];
  analysis: AnalysisRef[];
  exports: ExportTarget[];
  sequences: Sequence[];
  /**
   * Document-scoped <audio> declarations. Each entry is a sound the
   * Web Audio mixer can play (per-clip narration, background music
   * bed, sting). Audios are referenced from shots via
   * `<audio ref="bg-music" …>` or implicitly synced by id.
   */
  audios: AudioDecl[];
  /**
   * Document-scoped <adjustment> declarations. Each defines a named
   * CSS filter / color grade that any element can opt into via
   * `adjustment="warm"` (or directly inline via `filter=`).
   */
  adjustments: AdjustmentDecl[];
  unsupportedElements: UnsupportedElement[];
}

export interface Asset {
  id: string;
  kind: string;
  src: string;
}

export interface AnalysisRef {
  id: string;
  kind: string;
  asset?: string;
  src: string;
}

export interface ExportTarget {
  id: string;
  aspect: string;
  backend: string;
}

export interface Sequence {
  id: string;
  duration?: string;
  scenes: Scene[];
}

export interface Scene {
  id: string;
  duration?: string;
  composition?: string;
  shots: Shot[];
}

export interface Shot extends VisualAttrs {
  id: string;
  duration?: string;
  composition?: string;
  clips: Clip[];
  layers: Layer[];
  captions: Caption[];
  constraints: Constraint[];
  animations: Animation[];
  transitions: Transition[];
  /** Per-shot audio cues. */
  audios: AudioCue[];
  /** Per-shot adjustment overlays (applied to the shot wrapper). */
  adjustments: AdjustmentRef[];
}

export interface Clip extends VisualAttrs {
  id: string;
  asset: string;
  start?: string;
  duration?: string;
  in?: string;
  out?: string;
  sync?: string;
  /**
   * Inline CSS `filter:` string — e.g. `"brightness(0.9) saturate(1.2)"`.
   * Wins over any `adjustment=` named reference on the same element.
   */
  filter?: string;
  /** Named adjustment from `<adjustment>` document declarations. */
  adjustment?: string;
}

export interface Layer extends VisualAttrs {
  id: string;
  kind: string;
  role?: string;
  /**
   * Positional anchor. Recognised shorthands (`lower-third` /
   * `upper-third` / `center` / `title`) get default CSS; any other
   * value is passed through as a `data-anchor` token the author can
   * style themselves. Inline CSS coordinates (e.g. `top:240px`) go in
   * `style=` instead.
   */
  anchor?: string;
  safe?: string;
  src?: string;
  start?: string;
  duration?: string;
  text?: string;
  filter?: string;
  adjustment?: string;
}

export interface Caption extends VisualAttrs {
  id: string;
  source: string;
  /**
   * Rendering mode. Recognised shorthands: `word-highlight` (default)
   * and `line`. Any other value is treated as `"custom"` — the
   * runtime emits the raw words+timing and lets the author handle
   * rendering via the caption container's `class=` / `style=` and
   * the `data-mode` token.
   */
  mode?: string;
  /**
   * Positional anchor. Recognised shorthands: `lower-third` /
   * `upper-third` / `center` / `title`. Any other value is passed
   * through as a `data-anchor` token. For pixel-precise positioning,
   * use `style=` instead (e.g. `style="top:240px;left:5%"`).
   */
  anchor?: string;
  safe?: string;
}

export interface Constraint {
  id: string;
  kind: string;
  target?: string;
  value?: string;
}

export interface Animation extends VisualAttrs {
  id: string;
  subject: string;
  /**
   * Animation intent. Canonical shorthands (`reveal`, `enter`, `exit`,
   * `emphasize`, `pulse`, `drift`, `scale`, `move`, `hold`, `fade-in`,
   * `fade-out`) trigger the principle-based recipe library. Any other
   * value falls through to the default ease + the author's `from=` /
   * `to=` vars (if supplied). When `from=` / `to=` are present, they
   * win over the recipe.
   */
  intent: string;
  principle?: string;
  direction?: string;
  start?: string;
  duration?: string;
  easing?: string;
  /**
   * Custom GSAP `from` vars — JSON object string, e.g.
   * `from='{"x":-200,"opacity":0,"rotation":-15}'`. When supplied,
   * wins over the intent recipe. Use this to author motion that
   * doesn't fit any canonical intent without dropping to HF HTML.
   */
  from?: string;
  /**
   * Custom GSAP `to` vars (mutually exclusive with `from=`). Use for
   * outgoing emphasis tweens where the layer animates AWAY from its
   * rest state.
   */
  to?: string;
  /**
   * Shorthand for both `from` and `to`. Convenience form when you
   * just want to declare a single tween config — runtime treats it
   * as `from` unless `phase="out"` is set.
   */
  vars?: string;
  /**
   * Optional explicit phase — `"in"` (default) means animate FROM the
   * supplied vars to rest; `"out"` means animate TO the supplied vars
   * from rest.
   */
  phase?: "in" | "out";
}

export type TransitionPhase = "in" | "out";

export interface Transition extends VisualAttrs {
  id?: string;
  phase: TransitionPhase;
  /**
   * Transition kind. Canonical shorthands: `fade`, `cut`, `dissolve`,
   * `whip-pan`, `hold`. Any other value triggers the custom path —
   * combine with `from=` / `to=` / `easing=` to author arbitrary
   * shot-boundary motion.
   */
  kind: string;
  duration?: string;
  /** Hint for directional transitions (`whip-pan`, `wipe`). */
  direction?: string;
  /** Custom GSAP ease — wins over the kind's default. */
  easing?: string;
  /** Custom GSAP `from` vars (JSON object string). */
  from?: string;
  /** Custom GSAP `to` vars (JSON object string). */
  to?: string;
}

/**
 * Document-level audio declaration. Each entry is a sound the Web
 * Audio mixer can play — narration tracks, music beds, stings.
 */
export interface AudioDecl {
  id: string;
  src: string;
  /** Optional kind hint: `narration` | `music` | `sfx` (free-form). */
  kind?: string;
  /** Linear volume 0–1. Default 1. */
  volume?: number;
  /** Loop the audio while it's active. Default false. */
  loop?: boolean;
  /** Stereo pan -1 (left) to 1 (right). Default 0. */
  pan?: number;
}

/**
 * Per-shot audio cue. References an <audio> declared at the document
 * root and times it relative to the shot.
 */
export interface AudioCue {
  /** Audio decl id (must match an entry in document.audios). */
  ref: string;
  start?: string;
  duration?: string;
  /** Per-cue override of the decl's volume. */
  volume?: number;
  /**
   * When set, this cue ducks all other audio by `value` dB while
   * playing — typical use is narration ducking the music bed.
   */
  duck?: number;
  /**
   * Fade-in seconds at the start of the cue. Linear ramp.
   */
  fadeIn?: number;
  /** Fade-out seconds at the end of the cue. */
  fadeOut?: number;
  /** Stereo pan override. */
  pan?: number;
}

/**
 * Document-level adjustment declaration — a named CSS filter that
 * any element can opt into via `adjustment="<id>"`.
 */
export interface AdjustmentDecl {
  id: string;
  /** CSS filter string — e.g. `"brightness(0.9) contrast(1.1) saturate(0.8)"`. */
  filter: string;
  /**
   * Optional CSS `backdrop-filter` for blur/glass effects. Applied to
   * the same element when the runtime is asked to compose this
   * adjustment.
   */
  backdrop?: string;
  /** Optional CSS `mix-blend-mode`. */
  blend?: string;
}

/**
 * Per-shot adjustment overlay. Either references a named <adjustment>
 * decl or supplies its own inline `filter=`.
 */
export interface AdjustmentRef {
  ref?: string;
  filter?: string;
  backdrop?: string;
  blend?: string;
}

export interface UnsupportedElement {
  name: string;
  context: string;
}

// Resolved (absolute-frame) forms produced by `timeline.ts`.

export interface ResolvedTimeline {
  fps: Fps;
  resolution: Resolution;
  aspect: string;
  duration: FrameTime;
  sequences: ResolvedSequence[];
  /** Document-scoped audio declarations, indexable by id. */
  audios: AudioDecl[];
  /** Document-scoped adjustment declarations, indexable by id. */
  adjustments: AdjustmentDecl[];
}

export interface ResolvedSequence {
  id: string;
  startFrame: number;
  endFrame: number;
  scenes: ResolvedScene[];
}

export interface ResolvedScene {
  id: string;
  composition?: string;
  startFrame: number;
  endFrame: number;
  shots: ResolvedShot[];
}

export interface ResolvedShot extends VisualAttrs {
  id: string;
  composition?: string;
  startFrame: number;
  endFrame: number;
  clips: ResolvedClip[];
  layers: ResolvedLayer[];
  captions: ResolvedCaption[];
  constraints: ResolvedConstraint[];
  animations: ResolvedAnimation[];
  transitions: ResolvedTransition[];
  audios: ResolvedAudioCue[];
  adjustments: AdjustmentRef[];
}

export interface ResolvedClip extends VisualAttrs {
  id: string;
  asset: string;
  sourceInFrame: number;
  sourceOutFrame: number;
  startFrame: number;
  endFrame: number;
  filter?: string;
  adjustment?: string;
}

export interface ResolvedLayer extends VisualAttrs {
  id: string;
  kind: string;
  role?: string;
  anchor?: string;
  safe?: string;
  src?: string;
  text?: string;
  startFrame: number;
  endFrame: number;
  filter?: string;
  adjustment?: string;
}

export interface ResolvedCaption extends VisualAttrs {
  id: string;
  source: string;
  mode?: string;
  anchor?: string;
  safe?: string;
}

export interface ResolvedConstraint {
  id: string;
  kind: string;
  target?: string;
  value?: string;
}

export interface ResolvedAnimation extends VisualAttrs {
  id: string;
  intent: string;
  subject: string;
  direction?: string;
  principle?: string;
  /** Author-supplied ease, e.g. "power2.out", "back.out(1.7)".
   *  Overrides the principle's default ease in the gsapRunner.
   *  Was previously dropped from the resolver — see wb-dgx. */
  easing?: string;
  /** Parsed JSON object from the `from=` attribute. Wins over recipe. */
  fromVars?: Record<string, unknown>;
  /** Parsed JSON object from the `to=` attribute. Wins over recipe. */
  toVars?: Record<string, unknown>;
  phase?: "in" | "out";
  startFrame: number;
  endFrame: number;
}

export interface ResolvedTransition extends VisualAttrs {
  phase: TransitionPhase;
  kind: string;
  direction?: string;
  easing?: string;
  fromVars?: Record<string, unknown>;
  toVars?: Record<string, unknown>;
  startFrame: number;
  endFrame: number;
}

export interface ResolvedAudioCue {
  ref: string;
  startFrame: number;
  endFrame: number;
  volume?: number;
  duck?: number;
  fadeIn?: number;
  fadeOut?: number;
  pan?: number;
}

// Flat-entry projection used by the player to find what's on-screen at
// a given frame without recursing the tree.
export interface TimelineEntry {
  id: string;
  startFrame: number;
  endFrame: number;
  source: "sequence" | "scene" | "shot";
  composition?: string;
}

export interface ResolvedTimelineFlat extends ResolvedTimeline {
  entries: TimelineEntry[];
}

export class CwXmlError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "CwXmlError";
  }
}
