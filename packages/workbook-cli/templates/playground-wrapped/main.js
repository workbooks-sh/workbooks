// Wrapped workbook — minimal target for the sibling playground.
//
// One param (`bgHue`, declared in workbook.config.mjs) drives one
// visible effect: the CSS hue of the centered swatch. When loaded
// inside a playground, the parent writes the live value into a
// shared Y.doc and we react to changes. When opened standalone
// (no playground), we silently use the declared default.

const DEFAULT_HUE = 200;
const PARAM_KEY = "bg_hue";

const swatch = document.getElementById("swatch");
const readout = document.getElementById("hue-readout");
const standaloneNote = document.getElementById("standalone-note");

apply(DEFAULT_HUE);

// `window.__wbRuntime.playground` is populated by the auto-wire shim
// the playground injects into wrapped iframes (wb-22u.8). When absent
// — i.e. this artifact opened standalone — we stay on the default.
const runtime = typeof window !== "undefined" ? window.__wbRuntime : undefined;
const playground = runtime?.playground;

if (playground?.doc?.getMap) {
  const state = playground.doc.getMap("state");
  const params = state.get("params") ?? state.set("params", new (playground.Y?.Map ?? Map)());

  read(params);
  // Y.Map exposes .observe; plain Map (very unlikely runtime fallback) does not.
  if (typeof params.observe === "function") {
    params.observe(() => read(params));
  }
  state.observe?.(() => {
    const next = state.get("params");
    if (next && next !== params && typeof next.observe === "function") {
      next.observe(() => read(next));
      read(next);
    }
  });
} else {
  standaloneNote?.removeAttribute("hidden");
}

function read(params) {
  const raw = params?.get ? params.get(PARAM_KEY) : params?.[PARAM_KEY];
  const hue = clampHue(raw);
  apply(hue);
}

function apply(hue) {
  document.documentElement.style.setProperty("--bg-hue", String(hue));
  if (readout) readout.textContent = String(hue);
}

function clampHue(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_HUE;
  if (n < 0) return 0;
  if (n > 360) return 360;
  return Math.round(n);
}
