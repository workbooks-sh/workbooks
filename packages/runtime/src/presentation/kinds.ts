/**
 * Canonical slide archetypes — the 14 kinds a `<Slide kind="…">` can take.
 *
 * The set is closed: every slide in a workbook presentation MUST match
 * one of these. The skill at `packages/workbooks/skills/workbook-presentation/`
 * documents each archetype's purpose, content rules, and example usage.
 *
 * `backup` is special — backup slides register out-of-band so they
 * don't count toward `count` or the main `current` progress index.
 * Use `goToBackup(n)` from the presenter chrome to jump to one.
 */
export const SLIDE_KINDS = [
  "title",
  "section",
  "content",
  "stat",
  "quote",
  "image",
  "full-bleed",
  "comparison",
  "process",
  "code",
  "chart",
  "demo",
  "qa",
  "backup",
] as const;

export type SlideKind = (typeof SLIDE_KINDS)[number];

export function isSlideKind(value: unknown): value is SlideKind {
  return typeof value === "string" && (SLIDE_KINDS as readonly string[]).includes(value);
}
