// Embed the wrapped workbook bytes inside a playground build.
//
// Mirrors the source-bundle pattern (W1) for a different payload:
// instead of carrying the project tree, a playground carries the
// HTML of the workbook it wraps. At runtime the playground's
// iframe uses srcdoc with these bytes, sidestepping the cross-
// origin / auth-cookie chain that bites `src=https://workbooks.sh/...`.
//
// Element shape:
//
//   <script id="wb-wrapped"
//           type="application/x-workbook-wrapped"
//           data-format="html+gzip+base64"
//           data-version="1"
//           data-source="<URL or local path>"
//           data-uncompressed-size="14823">BASE64...</script>
//
// `type` is non-script so browsers ignore the tag entirely —
// zero runtime parse cost, same trick wb-source-bundle uses.
// At runtime Playground.svelte reads the tag, decodes via
// DecompressionStream("gzip"), and injects as srcdoc.

import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MARKER_OPEN = '<script id="wb-wrapped"';
const MARKER_CLOSE = "</script>";

/** Strip any prior embed so re-builds replace cleanly. */
function stripWrapped(html) {
  const start = html.indexOf(MARKER_OPEN);
  if (start < 0) return html;
  const end = html.indexOf(MARKER_CLOSE, start);
  if (end < 0) return html;
  return html.slice(0, start) + html.slice(end + MARKER_CLOSE.length);
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Sanity-check that the bytes look like a workbook HTML doc, not
 *  a 404 page or HTML wrapping JSON. We expect at least one of the
 *  workbook metadata script tags. */
function looksLikeWorkbook(html) {
  return (
    /id=["']wb-meta["']/i.test(html) ||
    /name=["']wb-permissions["']/i.test(html) ||
    /id=["']wb-spec["']/i.test(html) ||
    /id=["']workbook-spec["']/i.test(html)
  );
}

/** Fetch (URL) or read (local path) the wrapped workbook's HTML
 *  bytes. Returns { source, bytes } where source is the
 *  user-readable origin string we stamp as data-source. */
async function loadWrapped(wraps, fromDir) {
  if (typeof wraps !== "string" || wraps.length === 0) {
    throw new Error("playground.wraps is empty");
  }
  if (/^https?:\/\//i.test(wraps)) {
    const res = await fetch(wraps, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(
        `playground.wraps fetch failed (${res.status}): ${wraps}`,
      );
    }
    const html = await res.text();
    if (!looksLikeWorkbook(html)) {
      throw new Error(
        `playground.wraps fetched ${html.length} bytes from ${wraps} but it doesn't look like a workbook HTML doc (missing wb-meta / wb-permissions / wb-spec).`,
      );
    }
    return { source: wraps, bytes: Buffer.from(html, "utf8") };
  }
  /* Local path. defaultResolveWraps already normalized this to an
   * absolute path before our call site, but accept either form. */
  const abs = path.isAbsolute(wraps) ? wraps : path.resolve(fromDir, wraps);
  const html = await readFile(abs, "utf8");
  if (!looksLikeWorkbook(html)) {
    throw new Error(
      `playground.wraps local file ${abs} doesn't look like a workbook HTML doc.`,
    );
  }
  return { source: abs, bytes: Buffer.from(html, "utf8") };
}

/** Build the <script id="wb-wrapped"> tag from a wraps target.
 *  Returns the HTML to inject, or "" when no embed is wanted. */
export async function buildWrappedTag({ wraps, projectRoot }) {
  if (!wraps) return "";
  const { source, bytes } = await loadWrapped(wraps, projectRoot);
  const gz = gzipSync(bytes);
  const b64 = gz.toString("base64");
  const attrs = [
    'id="wb-wrapped"',
    'type="application/x-workbook-wrapped"',
    'data-format="html+gzip+base64"',
    'data-version="1"',
    `data-source="${escapeAttr(source)}"`,
    `data-uncompressed-size="${bytes.byteLength}"`,
    `data-bundle-size="${gz.byteLength}"`,
  ].join(" ");
  return `<script ${attrs}>${b64}</script>`;
}

export { stripWrapped };
