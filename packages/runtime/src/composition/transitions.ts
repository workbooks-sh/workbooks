// Shot-level transition registry. Each `<transition-in>` /
// `<transition-out>` resolves to a `{ enter, exit }` strategy that
// the gsapRunner stitches onto the shot's master timeline.
//
// Strategies return GSAP `from` / `to` vars — the runner is in charge
// of attaching them at the right position so the same paused-seek
// pattern keeps scrubbing accurate. CSS-only modes (no GSAP) drop
// `cssClass` tokens the Composition toggles on the shot wrapper for
// the duration of the transition window.

import type { ResolvedTransition } from "@work.books/cw-xml";

export type TransitionKind = "fade" | "cut" | "dissolve" | "whip-pan" | "hold";

/** GSAP vars (a Record<string, unknown>) handed to `tl.from` / `tl.to`. */
export type GsapVars = Record<string, unknown>;

export interface CompiledTransition {
  /** Duration in seconds. */
  duration: number;
  /** Vars for `tl.from(target, { ...vars, duration, ease }, position)`. */
  fromVars?: GsapVars;
  /**
   * Vars for `tl.to(target, ...)` instead of `from`. Used by exits so
   * the shot animates *away* from its rest state.
   */
  toVars?: GsapVars;
  /** GSAP ease. */
  ease: string;
  /**
   * Optional CSS class the Composition toggles on the shot wrapper
   * for the transition window. Useful for CSS-only fallbacks when
   * GSAP isn't loaded.
   */
  cssClass?: string;
}

/**
 * Compile a resolved transition into the shape the runner consumes.
 * `cut` and `hold` produce no animation (duration 0) — they're
 * markers the runner uses to skip the default fade.
 */
export function compileTransition(
  t: ResolvedTransition,
  fps: number,
): CompiledTransition {
  const seconds = Math.max(0, (t.endFrame - t.startFrame) / Math.max(1, fps));
  const isEnter = t.phase === "in";

  // Custom path — when the author supplied `from=` / `to=`, bypass the
  // kind switch entirely. `kind=` becomes shorthand only; explicit vars
  // always win. (`easing=` alone doesn't trigger this — it just
  // overrides the kind's default ease at the end.)
  if (t.fromVars || t.toVars) {
    return {
      duration: seconds,
      fromVars: isEnter ? t.fromVars : undefined,
      toVars: !isEnter ? (t.toVars ?? t.fromVars) : undefined,
      ease: t.easing ?? "power2.out",
    };
  }

  const base = compileTransitionByKind(t, seconds, isEnter);
  // Author easing= overrides the kind's default ease.
  return t.easing ? { ...base, ease: t.easing } : base;
}

function compileTransitionByKind(
  t: ResolvedTransition,
  seconds: number,
  isEnter: boolean,
): CompiledTransition {
  switch (t.kind as TransitionKind) {
    case "cut":
      // Cut = instant. Zero duration; no vars. Runner will skip it.
      return { duration: 0, ease: "none" };

    case "hold":
      // Hold = stay put. The shot mounts visible from the first frame
      // and stays at rest for the window. We model it as a zero-tween.
      return { duration: 0, ease: "none" };

    case "fade":
      return isEnter
        ? {
            duration: seconds,
            fromVars: { autoAlpha: 0 },
            ease: "power2.out",
            cssClass: "wb-transition-fade-in",
          }
        : {
            duration: seconds,
            toVars: { autoAlpha: 0 },
            ease: "power2.in",
            cssClass: "wb-transition-fade-out",
          };

    case "dissolve":
      // Dissolve is fade + a tiny scale push so successive shots feel
      // continuous rather than punch-cut. Slower curve than fade.
      return isEnter
        ? {
            duration: seconds,
            fromVars: { autoAlpha: 0, scale: 1.04 },
            ease: "sine.inOut",
            cssClass: "wb-transition-dissolve-in",
          }
        : {
            duration: seconds,
            toVars: { autoAlpha: 0, scale: 0.97 },
            ease: "sine.inOut",
            cssClass: "wb-transition-dissolve-out",
          };

    case "whip-pan": {
      // Whip-pan = fast directional slide with a touch of blur. The
      // direction attribute tells us which way to launch from.
      const mag = whipMagnitude(t.direction, isEnter);
      return isEnter
        ? {
            duration: seconds,
            fromVars: { autoAlpha: 0, ...mag },
            ease: "power3.out",
            cssClass: "wb-transition-whip-in",
          }
        : {
            duration: seconds,
            toVars: { autoAlpha: 0, ...mag },
            ease: "power3.in",
            cssClass: "wb-transition-whip-out",
          };
    }

    default:
      // Unknown kind — fall back to a soft fade so we don't leave the
      // shot stuck invisible.
      return isEnter
        ? { duration: seconds, fromVars: { autoAlpha: 0 }, ease: "power2.out" }
        : { duration: seconds, toVars: { autoAlpha: 0 }, ease: "power2.in" };
  }
}

function whipMagnitude(direction: string | undefined, isEnter: boolean): GsapVars {
  // Entrances launch FROM off-frame toward the resting position.
  // Exits leave TOWARD off-frame. The runner uses `from` for entrances
  // and `to` for exits, so we just need the right sign here.
  const MAG_PX = 240;
  const sign = isEnter ? 1 : -1;
  switch (direction) {
    case "left":  return { x:  MAG_PX * sign };
    case "right": return { x: -MAG_PX * sign };
    case "up":    return { y:  MAG_PX * sign };
    case "down":  return { y: -MAG_PX * sign };
    default:      return { x:  MAG_PX * sign };
  }
}

/**
 * Helper for callers that just want to know whether a kind is a no-op
 * (cut / hold). Saves them from importing the union type.
 */
export function isNoOpTransition(kind: string): boolean {
  return kind === "cut" || kind === "hold";
}
