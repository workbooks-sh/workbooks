export type PanelSide = "left" | "right" | "bottom";

export type PanelSlot = "effects" | "chat" | "terminal" | null;

export interface StageConfig {
  wraps: string;
  panels: {
    left: PanelSlot;
    right: PanelSlot;
    bottom: PanelSlot;
  };
}

/** @deprecated Use StageConfig. Kept as a re-export so legacy imports
 *  of `PlaygroundConfig` from runtime artifacts built before the stage
 *  rename keep type-resolving. */
export type PlaygroundConfig = StageConfig;
