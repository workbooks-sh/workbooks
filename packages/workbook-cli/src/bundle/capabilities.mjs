// Extract the `<script id="wb-capabilities">` tool manifest from a
// compiled workbook .html. Mirrors the embed shape in
// plugins/workbookInline.mjs > buildCapabilitiesTag.
//
//   <script id="wb-capabilities"
//           type="application/x-workbook-capabilities"
//           data-version="1"
//           data-tool-count="N">[ {...tool...}, ... ]</script>
//
// Returns `null` when the tag is missing or malformed — the broker
// treats absence as "this workbook declares no tools", never as an
// error.

const MARKER_OPEN = '<script id="wb-capabilities"';
const MARKER_CLOSE = "</script>";

export function extractCapabilities(html) {
  const start = html.indexOf(MARKER_OPEN);
  if (start < 0) return null;
  const tagEnd = html.indexOf(">", start);
  if (tagEnd < 0) return null;
  const close = html.indexOf(MARKER_CLOSE, tagEnd);
  if (close < 0) return null;
  const body = html.slice(tagEnd + 1, close).trim();
  if (!body) return null;
  let parsed;
  try { parsed = JSON.parse(body); }
  catch { return null; }
  if (!Array.isArray(parsed)) return null;
  return parsed;
}
