// GSAP runner — translates CW XML <animation> entries into a single
// master timeline and drives that timeline off the Theater playhead.
// GSAP is an optional peer dep; if it's missing we degrade to no-op
// (the layers still mount, they just won't animate).
//
// The intent → tween shape map (the "recipe library") lives in
// `@work.books/cw-xml`'s principles module — see
// `packages/workbooks/packages/cw-xml/src/principles.ts` (mirror of the
// Rust crate at `gamut/crates/motion/src/principles.rs`). This runner
// just looks the recipe up, optionally lets the XML override the
// `duration` / `easing`, and feeds it to GSAP.

import {
  tweenRecipe,
  transformsToGsapVars,
  type ResolvedAnimation,
  type ResolvedShot,
} from "@work.books/cw-xml";
import { compileTransition, isNoOpTransition } from "./transitions";

type GsapModule = typeof import("gsap")["gsap"] | null;

let cachedGsap: GsapModule | undefined;

async function loadGsap(): Promise<GsapModule> {
  if (cachedGsap !== undefined) return cachedGsap;
  try {
    const mod = await import("gsap");
    cachedGsap = mod.gsap ?? (mod.default as any)?.gsap ?? (mod as any).default ?? null;
  } catch {
    cachedGsap = null;
  }
  return cachedGsap;
}

export interface CompiledTimeline {
  /** Total duration in seconds (matches shot duration). */
  duration: number;
  /** Seek the timeline to `seconds` and pause. */
  seek(seconds: number): void;
  /** Start playing from current head. */
  play(fromSeconds?: number): void;
  /** Pause; head stays put. */
  pause(): void;
  /** Tear down — kill all tweens, revert inline styles. */
  destroy(): void;
}

interface IntentTween {
  /** GSAP `.from` vars — the layer starts here, animates to current state. */
  from?: Record<string, unknown>;
  /** GSAP `.to` vars — the layer animates AWAY from rest toward these. */
  to?: Record<string, unknown>;
  /** Default duration in seconds if the XML didn't specify. */
  duration: number;
  /** GSAP ease string. */
  ease: string;
}

function intentToTween(anim: ResolvedAnimation, fps: number): IntentTween | null {
  const xmlSeconds = (anim.endFrame - anim.startFrame) / Math.max(1, fps);

  // Custom vars win — when the author supplied `from=` or `to=`, the
  // intent recipe is bypassed entirely. This is the escape hatch that
  // lets agents author arbitrary motion without dropping to HF HTML.
  if (anim.fromVars || anim.toVars) {
    const duration = xmlSeconds > 0 ? xmlSeconds : 0.5;
    return {
      from: anim.fromVars,
      to: anim.toVars,
      duration,
      // No principle ease fallback when going custom — author chose to
      // own the motion, so we trust their easing= or default to
      // power2.out.
      ease: anim.easing ?? "power2.out",
    };
  }

  const recipe = tweenRecipe(anim.principle, anim.intent, anim.direction);
  if (recipe.transforms.length === 0) {
    // `hold` and friends — nothing to animate.
    return null;
  }
  // XML duration wins when the author specified one. The recipe's
  // duration is the "if you wrote nothing sensible" fallback.
  const duration = xmlSeconds > 0 ? xmlSeconds : recipe.durationMs / 1000;
  return {
    from: transformsToGsapVars(recipe.transforms),
    duration,
    ease: recipe.ease,
  };
}

/**
 * Compile every <animation> in a shot into a single paused GSAP
 * timeline that the player drives via seek(). Returns null if GSAP
 * isn't installed (degraded mode).
 */
export async function compileShotTimeline(
  shotEl: HTMLElement,
  shot: ResolvedShot,
  fps: number,
): Promise<CompiledTimeline | null> {
  const gsap = await loadGsap();
  if (!gsap) return null;

  const tl = (gsap as any).timeline({ paused: true });
  const shotDurationSec = (shot.endFrame - shot.startFrame) / Math.max(1, fps);

  // Shot-level transitions sit on the shot wrapper itself, not on a
  // child. They run at the boundaries of the timeline so the master
  // timeline's duration always equals the shot duration.
  for (const t of shot.transitions) {
    if (isNoOpTransition(t.kind)) continue;
    const compiled = compileTransition(t, fps);
    if (compiled.duration <= 0) continue;
    if (t.phase === "in" && compiled.fromVars) {
      tl.from(shotEl, {
        ...compiled.fromVars,
        duration: compiled.duration,
        ease: compiled.ease,
      }, 0);
    } else if (t.phase === "out" && compiled.toVars) {
      tl.to(shotEl, {
        ...compiled.toVars,
        duration: compiled.duration,
        ease: compiled.ease,
      }, Math.max(0, shotDurationSec - compiled.duration));
    }
  }

  for (const anim of shot.animations) {
    const tween = intentToTween(anim, fps);
    if (!tween) continue;
    const target = shotEl.querySelector(`[data-anim-subject="${anim.subject}"], #${cssEscape(anim.subject)}`);
    if (!target) continue;
    const offset = (anim.startFrame - shot.startFrame) / Math.max(1, fps);
    const ease = anim.easing ?? tween.ease;
    if (tween.to) {
      // Author wrote `to=` (or phase="out" with vars=) — animate AWAY
      // from the rest state.
      tl.to(target, {
        ...tween.to,
        duration: tween.duration,
        ease,
      }, Math.max(0, offset));
    } else if (tween.from) {
      tl.from(target, {
        ...tween.from,
        duration: tween.duration,
        ease,
      }, Math.max(0, offset));
    }
  }

  return {
    duration: shotDurationSec,
    seek(seconds: number) {
      const clamped = Math.max(0, Math.min(tl.duration() || shotDurationSec, seconds));
      tl.pause();
      tl.seek(clamped, false);
    },
    play(fromSeconds?: number) {
      if (typeof fromSeconds === "number") tl.seek(Math.max(0, fromSeconds), false);
      tl.play();
    },
    pause() {
      tl.pause();
    },
    destroy() {
      tl.kill();
    },
  };
}

function cssEscape(id: string): string {
  if (typeof (window as any).CSS?.escape === "function") {
    return (window as any).CSS.escape(id);
  }
  return id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
