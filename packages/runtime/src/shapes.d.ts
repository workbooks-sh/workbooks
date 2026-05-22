export type WorkbookShape = "document" | "notebook" | "spa" | "presentation" | "agent";

export type WorkbookShapeMeta = {
  /** Human label for pickers ("Document", "Notebook", …). */
  label: string;
  /** One-sentence summary of what the shape does. */
  description: string;
  /** What the READER does with this shape — the disambiguator. */
  readerDoes: string;
};

export type WorkbookShapeColor = {
  /** Foreground (text + icon) color for the shape pill. */
  fg: string;
  /** Background fill for the shape pill. Translucent so it sits on
   *  thumbnails + cards without overpowering them. */
  bg: string;
  /** Outline / ring color for affordances that need a stronger edge. */
  ring: string;
};

export declare const WORKBOOK_SHAPES: readonly WorkbookShape[];
export declare const SHAPE_DESCRIPTIONS: Readonly<Record<WorkbookShape, WorkbookShapeMeta>>;
export declare const SHAPE_COLORS: Readonly<Record<WorkbookShape, WorkbookShapeColor>>;
export declare function isWorkbookShape(v: unknown): v is WorkbookShape;
