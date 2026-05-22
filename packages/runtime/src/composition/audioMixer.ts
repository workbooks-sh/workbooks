// Web Audio mixer for CW XML <audio> elements.
//
// Each <audio> in the document is a sound the mixer can play —
// narration tracks, music beds, stings. Per-shot <audio ref="…">
// cues schedule those sounds against the timeline with per-cue
// volume / pan / duck / fade overrides.
//
// The mixer is playhead-driven: the Theater calls `seek(frame)` /
// `play()` / `pause()` and the mixer reacts. No internal timer.
//
// Ducking model: while any cue with `duck: dB` is active, every
// OTHER cue's gain is multiplied by `10^(-dB/20)` (linear-from-dB).
// Reverts when the ducking cue ends.

import type { AudioDecl, ResolvedAudioCue } from "@work.books/cw-xml";

interface CueRuntime {
  cue: ResolvedAudioCue;
  decl: AudioDecl;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  panner: StereoPannerNode;
  buffer: AudioBuffer | null;
  /** Last seconds value we applied — used to detect seek vs. play drift. */
  lastApplied: number;
  /** True between play() and the next pause()/seek-out-of-range. */
  active: boolean;
}

export interface MixerOptions {
  fps: number;
  baseUrl?: string | null;
}

export class AudioMixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cues: CueRuntime[] = [];
  private fps = 30;
  private baseUrl: string | null = null;
  private destroyed = false;
  private playing = false;
  private bufferCache = new Map<string, Promise<AudioBuffer>>();

  constructor(opts: MixerOptions) {
    this.fps = Math.max(1, opts.fps);
    this.baseUrl = opts.baseUrl ?? null;
  }

  /**
   * Replace the cue set. Existing cues that aren't in `cues` are
   * killed; cues that match are kept playing. Safe to call from a
   * Svelte $effect.
   */
  async load(cues: ResolvedAudioCue[], decls: AudioDecl[]): Promise<void> {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    const declById = new Map(decls.map((d) => [d.id, d]));

    // Tear down anything that's no longer in the set. (Identity by
    // ref+startFrame+endFrame — close enough for swap detection.)
    const keyOf = (c: ResolvedAudioCue) => `${c.ref}@${c.startFrame}-${c.endFrame}`;
    const nextKeys = new Set(cues.map(keyOf));
    this.cues = this.cues.filter((r) => {
      if (nextKeys.has(keyOf(r.cue))) return true;
      this.stopCue(r);
      return false;
    });

    const existing = new Set(this.cues.map((r) => keyOf(r.cue)));
    for (const cue of cues) {
      if (existing.has(keyOf(cue))) continue;
      const decl = declById.get(cue.ref);
      if (!decl) continue; // dangling ref — skip silently
      const gain = this.ctx.createGain();
      const panner = this.ctx.createStereoPanner();
      gain.gain.value = 0; // start silent; fades + envelope set this each tick
      panner.pan.value = cue.pan ?? decl.pan ?? 0;
      gain.connect(panner).connect(this.master);
      const runtime: CueRuntime = {
        cue,
        decl,
        source: null,
        gain,
        panner,
        buffer: null,
        lastApplied: -1,
        active: false,
      };
      this.cues.push(runtime);
      void this.loadBuffer(decl).then((buf) => {
        if (this.destroyed) return;
        runtime.buffer = buf;
      });
    }
  }

  /** Resolve the cue gains for the given playhead frame. */
  seek(frame: number): void {
    if (!this.ctx) return;
    const seconds = frame / this.fps;
    // First pass — work out which cues are active and what duck level
    // they collectively impose on other cues.
    let activeDuckDb = 0;
    for (const r of this.cues) {
      const within = frame >= r.cue.startFrame && frame < r.cue.endFrame;
      if (within && (r.cue.duck ?? 0) > activeDuckDb) {
        activeDuckDb = r.cue.duck ?? 0;
      }
    }
    const duckLinear = activeDuckDb > 0 ? Math.pow(10, -activeDuckDb / 20) : 1;

    for (const r of this.cues) {
      const within = frame >= r.cue.startFrame && frame < r.cue.endFrame;
      if (!within) {
        if (r.active) this.stopCue(r);
        continue;
      }
      const cueSeconds = seconds - r.cue.startFrame / this.fps;
      const cueLen = (r.cue.endFrame - r.cue.startFrame) / this.fps;
      const baseVol = r.cue.volume ?? r.decl.volume ?? 1;
      const fadeIn = r.cue.fadeIn ?? 0;
      const fadeOut = r.cue.fadeOut ?? 0;
      let envelope = 1;
      if (fadeIn > 0 && cueSeconds < fadeIn) envelope *= cueSeconds / fadeIn;
      if (fadeOut > 0 && cueSeconds > cueLen - fadeOut) {
        envelope *= Math.max(0, (cueLen - cueSeconds) / fadeOut);
      }
      // Don't duck the cue that's CAUSING the duck — only other cues.
      const isDuckSource = (r.cue.duck ?? 0) >= activeDuckDb && activeDuckDb > 0;
      const duckMul = isDuckSource ? 1 : duckLinear;
      r.gain.gain.value = baseVol * envelope * duckMul;
      if (this.playing && !r.active && r.buffer) {
        this.startCueAt(r, cueSeconds);
      } else if (r.active && r.source) {
        // Detect scrub — if the playhead jumped beyond the smooth-play
        // tolerance, restart the source at the new offset.
        if (Math.abs(cueSeconds - r.lastApplied) > 0.1 && !this.playing) {
          this.stopCue(r);
        } else {
          r.lastApplied = cueSeconds;
        }
      }
    }
  }

  play(): void {
    this.ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
    for (const r of this.cues) {
      if (r.active) this.stopCue(r);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.pause();
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close().catch(() => undefined);
    }
    this.cues = [];
    this.ctx = null;
    this.master = null;
  }

  /** Set the master gain (0..1). Theater wires its volume slider through here. */
  setMasterVolume(value: number, muted: boolean): void {
    if (!this.master) return;
    this.master.gain.value = muted ? 0 : Math.max(0, Math.min(1, value));
  }

  private ensureContext(): void {
    if (this.ctx || typeof window === "undefined") return;
    const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx!.createGain();
    this.master!.gain.value = 1;
    this.master!.connect(this.ctx!.destination);
  }

  private async loadBuffer(decl: AudioDecl): Promise<AudioBuffer> {
    const url = this.resolveUrl(decl.src);
    const existing = this.bufferCache.get(url);
    if (existing) return existing;
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`audio fetch ${url} → ${res.status}`);
      const arr = await res.arrayBuffer();
      return await new Promise<AudioBuffer>((resolve, reject) => {
        this.ctx!.decodeAudioData(arr, resolve, reject);
      });
    })();
    this.bufferCache.set(url, p);
    return p;
  }

  private resolveUrl(src: string): string {
    if (!this.baseUrl) return src;
    try {
      return new URL(src, new URL(this.baseUrl, window.location.href)).toString();
    } catch {
      return src;
    }
  }

  private startCueAt(r: CueRuntime, offsetSeconds: number): void {
    if (!this.ctx || !r.buffer) return;
    const node = this.ctx.createBufferSource();
    node.buffer = r.buffer;
    node.loop = !!r.decl.loop;
    node.connect(r.gain);
    const safeOffset = Math.max(0, offsetSeconds % r.buffer.duration);
    try {
      node.start(0, safeOffset);
    } catch {
      // start() throws if called twice; safe to swallow — we always
      // create a fresh node before calling start.
    }
    r.source = node;
    r.lastApplied = offsetSeconds;
    r.active = true;
  }

  private stopCue(r: CueRuntime): void {
    if (r.source) {
      try { r.source.stop(); } catch { /* already stopped */ }
      try { r.source.disconnect(); } catch { /* disconnected */ }
    }
    r.source = null;
    r.active = false;
    r.lastApplied = -1;
  }
}
