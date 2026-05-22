/**
 * Logos — runtime accessor for brand SVGs baked into the workbook
 * artifact at `workbook build` time.
 *
 * The CLI fetches each logo declared in workbook.config.mjs's `logos`
 * field, base64-inlines them, and emits a `<script id="wb-logos">`
 * tag holding `{ [as]: { dataUrl, svg } }`. Workbooks consume the
 * map via `wb.logos.<as>.dataUrl` (for an `<img src>`) or
 * `wb.logos.<as>.svg` (for `{@html}` so the SVG inherits currentColor).
 *
 * Parses lazily on first access. Returns an empty map when no
 * payload is present — covers dev / no-logos / pre-bundle states
 * without forcing every workbook to feature-detect.
 */

export interface Logo {
  dataUrl: string;
  svg: string;
}

export type LogoMap = Record<string, Logo>;

let _cached: LogoMap | null = null;

export function getLogos(): LogoMap {
  if (_cached) return _cached;
  if (typeof document === "undefined") {
    _cached = {};
    return _cached;
  }
  const el = document.getElementById("wb-logos");
  if (!el || !el.textContent) {
    _cached = {};
    return _cached;
  }
  try {
    const parsed = JSON.parse(el.textContent);
    if (parsed && typeof parsed === "object") {
      _cached = parsed as LogoMap;
      return _cached;
    }
  } catch {
    // Malformed payload — fall through to empty map. The build
    // pipeline shouldn't emit bad JSON; if it does, dropping silently
    // is friendlier than throwing on every page load.
  }
  _cached = {};
  return _cached;
}
