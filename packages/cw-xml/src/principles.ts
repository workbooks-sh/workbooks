// Animation-principle recipe library.
//
// Browser/runtime port of the Rust principle table living at
// `vendor/colorwave/packages/gamut/crates/motion/src/principles.rs`.
// Keep both in sync when you edit either. The shape mirrors the
// `TweenRecipe` struct: { durationMs, ease, transforms[] }.
//
// Consumers: `runtime/src/composition/gsapRunner.ts` calls
// `tweenRecipe(principle, intent, direction)` to compile every
// `<animation>` into a paused GSAP tween.

export type TransformOp =
  | { op: "translate-x"; px: number }
  | { op: "translate-y"; px: number }
  | { op: "scale"; factor: number }
  | { op: "auto-alpha"; value: number }
  | { op: "rotate"; deg: number };

export interface TweenRecipe {
  durationMs: number;
  ease: string;
  transforms: TransformOp[];
}

/**
 * Look up the recipe for a (principle, intent, direction) triple.
 *
 * Unknown principles fall back to a sensible default per intent.
 * Unknown intents fall back to a generic `from {autoAlpha: 0, y: 30}`
 * reveal. Direction only applies to translating intents
 * (reveal / enter / exit / move); ignored for scale / emphasize.
 */
export function tweenRecipe(
  principle: string | undefined,
  intent: string,
  direction: string | undefined,
): TweenRecipe {
  return {
    durationMs: durationFor(principle, intent),
    ease: easeFor(principle, intent),
    transforms: transformsFor(principle, intent, direction),
  };
}

function easeFor(principle: string | undefined, intent: string): string {
  const exit = intent === "exit" || intent === "fade-out";
  const between = intent === "move" || intent === "drift";

  switch (principle) {
    case "anticipation":
      return exit ? "back.in(1.4)" : "back.out(1.4)";
    case "follow-through":
      return exit ? "power2.in" : "power2.out";
    case "overlap":
      return "sine.inOut";
    case "ease-in":
      return "power2.in";
    case "ease-out":
      return "power3.out";
    case "staging":
      return exit ? "power3.in" : "power3.out";
    case "timing":
      return "sine.inOut";
    case "secondary-action":
      return exit ? "power1.in" : "power1.out";
    default:
      if (exit) return "power2.in";
      if (between) return "sine.inOut";
      return "power2.out";
  }
}

function durationFor(principle: string | undefined, intent: string): number {
  const exit = intent === "exit" || intent === "fade-out";

  let base: number;
  switch (principle) {
    case "anticipation":     base = 600; break;
    case "follow-through":   base = 500; break;
    case "overlap":          base = 450; break;
    case "ease-in":
    case "ease-out":         base = 400; break;
    case "staging":          base = 700; break;
    case "timing":           base = 500; break;
    case "secondary-action": base = 350; break;
    default:
      switch (intent) {
        case "emphasize":
        case "pulse":  base = 300; break;
        case "scale":  base = 450; break;
        case "move":
        case "drift":  base = 600; break;
        case "hold":   base = 0;   break;
        default:       base = 450;
      }
  }

  return exit ? Math.round(base * 0.6) : base;
}

function transformsFor(
  principle: string | undefined,
  intent: string,
  direction: string | undefined,
): TransformOp[] {
  switch (intent) {
    case "reveal":
    case "enter":
    case "fade-in": {
      const t: TransformOp[] = [{ op: "auto-alpha", value: 0 }];
      if (principle === "anticipation") {
        t.push({ op: "scale", factor: 0.92 });
      }
      t.push(...directionalOffset(direction, 40));
      return t;
    }
    case "exit":
    case "fade-out":
      return [{ op: "auto-alpha", value: 1 }];
    case "emphasize":
    case "pulse":
      return [{ op: "scale", factor: 1 }];
    case "scale":
      return [
        { op: "scale", factor: 0.85 },
        { op: "auto-alpha", value: 0 },
      ];
    case "move":
    case "drift":
      return directionalOffset(direction, 80);
    case "hold":
      return [];
    default:
      return [
        { op: "auto-alpha", value: 0 },
        { op: "translate-y", px: 30 },
      ];
  }
}

function directionalOffset(
  direction: string | undefined,
  magnitude: number,
): TransformOp[] {
  switch (direction) {
    case "up":    return [{ op: "translate-y", px: magnitude }];
    case "down":  return [{ op: "translate-y", px: -magnitude }];
    case "left":  return [{ op: "translate-x", px: magnitude }];
    case "right": return [{ op: "translate-x", px: -magnitude }];
    default:      return [{ op: "translate-y", px: magnitude }];
  }
}

/**
 * Translate a TransformOp[] into a GSAP `from` vars object.
 * Centralised so the runner doesn't have to know about the op shape.
 */
export function transformsToGsapVars(ops: TransformOp[]): Record<string, number> {
  const vars: Record<string, number> = {};
  for (const op of ops) {
    switch (op.op) {
      case "translate-x": vars.x = op.px; break;
      case "translate-y": vars.y = op.px; break;
      case "scale":       vars.scale = op.factor; break;
      case "auto-alpha":  vars.autoAlpha = op.value; break;
      case "rotate":      vars.rotation = op.deg; break;
    }
  }
  return vars;
}
