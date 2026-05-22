// Extract the `<script id="wb-params">` playground-tunable manifest
// from a compiled workbook .html. Mirrors the embed shape in
// plugins/workbookInline.mjs > buildParamsTag.
//
//   <script id="wb-params"
//           type="application/x-workbook-params"
//           data-version="1"
//           data-param-count="N">{ "name": { "type": "...", ... }, ... }</script>
//
// Returns `null` when the tag is missing or malformed. Distinct from
// wb-capabilities — params are private-to-playground (NOT MCP-callable);
// tools are publicly callable.

const MARKER_OPEN = '<script id="wb-params"';
const MARKER_CLOSE = "</script>";

export function extractParams(html) {
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}
