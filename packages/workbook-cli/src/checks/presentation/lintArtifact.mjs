// `workbook check <built.html>` — lint a built presentation artifact.
//
// Loads the .html in a headless browser, iterates each slide via the
// presentation runtime (keyboard nav), runs 6 rules per slide, emits a
// pretty (default) or JSON (--json) report.
//
// Exit codes:
//   0 — no FAIL-severity findings (or --no-fail)
//   1 — at least one FAIL
//   2 — fatal (missing artifact, no browser driver, not a presentation)

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ALL_RULES = Object.freeze([
  "overflow",
  "missing-archetype",
  "palette-drift",
  "near-duplicate",
  "demo-no-fallback",
  "unstyled-slide",
]);

const KNOWN_KINDS = new Set([
  "title", "section", "content", "stat", "quote", "image",
  "full-bleed", "comparison", "process", "code", "chart",
  "demo", "qa", "backup",
]);

/**
 * @typedef {Object} Finding
 * @property {string} rule
 * @property {"fail"|"warn"} severity
 * @property {number} slide       1-indexed
 * @property {string|null} kind
 * @property {string} message
 * @property {string=} selector
 */

/**
 * @param {{
 *   artifact: string,
 *   json?: boolean,
 *   rules?: string,
 *   "no-fail"?: boolean,
 * }} opts
 */
export async function runLintArtifact(opts) {
  const artifact = path.resolve(opts.artifact);
  try {
    const st = await fs.stat(artifact);
    if (!st.isFile()) throw new Error("not a file");
  } catch {
    process.stderr.write(`workbook check: cannot read ${artifact}\n`);
    process.exit(2);
  }

  const enabled = typeof opts.rules === "string"
    ? new Set(opts.rules.split(",").map((s) => s.trim()).filter(Boolean))
    : new Set(ALL_RULES);
  for (const r of enabled) {
    if (!ALL_RULES.includes(r)) {
      process.stderr.write(
        `workbook check: unknown rule "${r}". Known: ${ALL_RULES.join(", ")}\n`,
      );
      process.exit(2);
    }
  }

  const puppeteer = await loadDriver();
  const browser = await puppeteer.launch({ headless: "new" });
  let findings = [];
  let slideCount = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 2200, height: 1300 });
    await page.goto(pathToFileURL(artifact).href, { waitUntil: "networkidle0" });
    try {
      await page.waitForSelector(".workbook-presentation-stage", { timeout: 8000 });
    } catch {
      process.stderr.write(
        `workbook check: ${path.relative(process.cwd(), artifact)} is not a presentation ` +
          `(no .workbook-presentation-stage found after load)\n`,
      );
      await browser.close();
      process.exit(2);
    }

    slideCount = await page.evaluate(() => {
      return document.querySelectorAll(".wb-slide:not([data-slide-backup])").length;
    });
    if (slideCount === 0) {
      process.stderr.write(`workbook check: presentation has no slides\n`);
      await browser.close();
      process.exit(2);
    }

    // Collect theme palette once (rooted at presentation element).
    const palette = enabled.has("palette-drift")
      ? await page.evaluate(extractPaletteInPage)
      : [];

    // Iterate slides via keyboard nav. Slide 0 is already active.
    const slideTexts = [];
    for (let i = 0; i < slideCount; i++) {
      if (i > 0) {
        await page.keyboard.press("ArrowRight");
        // Brief settle for transitions / measurement.
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
      }
      const data = await page.evaluate(measureActiveSlideInPage);
      if (!data) continue;

      const oneBased = i + 1;
      const kind = data.kind;

      if (enabled.has("missing-archetype")) {
        if (!data.kind || !KNOWN_KINDS.has(data.kind)) {
          findings.push({
            rule: "missing-archetype",
            severity: "fail",
            slide: oneBased,
            kind: kind,
            message: `no archetype class (expected wb-slide--<one of ${[...KNOWN_KINDS].join("/")}>)`,
          });
        }
      }

      if (enabled.has("unstyled-slide")) {
        if (data.empty) {
          findings.push({
            rule: "unstyled-slide",
            severity: "fail",
            slide: oneBased,
            kind,
            message: "empty (.wb-slide-inner has no text and no element children)",
          });
        }
      }

      if (enabled.has("overflow")) {
        for (const o of data.overflows) {
          findings.push({
            rule: "overflow",
            severity: "fail",
            slide: oneBased,
            kind,
            selector: o.selector,
            message: `element <${o.selector}> overflows by ${o.right}px (right) / ${o.bottom}px (bottom)`,
          });
        }
      }

      if (enabled.has("demo-no-fallback")) {
        if (kind === "demo" && !data.hasFallback) {
          findings.push({
            rule: "demo-no-fallback",
            severity: "warn",
            slide: oneBased,
            kind,
            message: "no static fallback (expected <img>/<video> child or data-fallback)",
          });
        }
      }

      if (enabled.has("palette-drift") && palette.length > 0) {
        for (const drift of data.driftColors) {
          if (driftDeltaE(drift.lab, palette) > 8) {
            findings.push({
              rule: "palette-drift",
              severity: "warn",
              slide: oneBased,
              kind,
              selector: drift.selector,
              message: `${drift.prop}=${drift.value} drifts from theme palette`,
            });
          }
        }
      }

      slideTexts.push({ idx: oneBased, kind, text: data.normalizedText });
    }

    if (enabled.has("near-duplicate")) {
      for (let a = 0; a < slideTexts.length; a++) {
        for (let b = a + 1; b < slideTexts.length; b++) {
          const A = slideTexts[a].text;
          const B = slideTexts[b].text;
          const longer = A.length >= B.length ? A : B;
          if (longer.length < 50) continue;
          const dist = levenshtein(A, B);
          const ratio = dist / longer.length;
          if (ratio < 0.1) {
            const pct = Math.round((1 - ratio) * 100);
            findings.push({
              rule: "near-duplicate",
              severity: "warn",
              slide: slideTexts[a].idx,
              kind: slideTexts[a].kind,
              message: `slides ${slideTexts[a].idx} and ${slideTexts[b].idx} have near-duplicate content (${pct}% similarity)`,
            });
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  // Dedupe near-duplicate pairs (we emit one per slide-a, but the message
  // already mentions both — fine).

  const failed = findings.filter((f) => f.severity === "fail").length;
  const warned = findings.filter((f) => f.severity === "warn").length;
  const firedRules = new Set(findings.map((f) => f.rule));
  const passed = [...enabled].filter((r) => !firedRules.has(r)).length;
  const exitCode = (opts["no-fail"] || failed === 0) ? 0 : 1;
  const summary = { passed, failed, warnings: warned, exitCode };

  if (opts.json) {
    const payload = {
      artifact: path.relative(process.cwd(), artifact) || artifact,
      findings,
      summary,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    writePretty(artifact, findings, [...enabled], summary);
  }

  process.exit(exitCode);
}

async function loadDriver() {
  try {
    const mod = await import("puppeteer");
    return mod.default ?? mod;
  } catch {
    try {
      // Playwright fallback (chromium API differs slightly; we never get
      // here in practice because puppeteer is an optional dep, but if a
      // user has only playwright we want a useful error).
      await import("playwright");
      throw new Error("playwright detected but unsupported — install puppeteer");
    } catch {
      process.stderr.write(
        "workbook check requires puppeteer. Install it with:\n" +
          "  npm install -D puppeteer\n",
      );
      process.exit(2);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// In-page helpers (serialized via page.evaluate).
// ────────────────────────────────────────────────────────────────────────────

function extractPaletteInPage() {
  function parseColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    const a = m[4] != null ? Number(m[4]) : 1;
    if (a < 0.05) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  function srgbToLab([R, G, B]) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = lin(R), g = lin(G), b = lin(B);
    // sRGB → XYZ (D65)
    const X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    const Z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
    const xn = X / 0.95047, yn = Y / 1.0, zn = Z / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(yn) - 16, 500 * (f(xn) - f(yn)), 200 * (f(yn) - f(zn))];
  }

  const root = document.querySelector(".workbook-presentation") ||
               document.querySelector(":root");
  const cs = getComputedStyle(root);
  const out = [];
  // Computed style of an element exposes only resolved properties; for
  // custom properties we need to enumerate from the document stylesheets.
  const seen = new Set();
  function tryPush(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const raw = cs.getPropertyValue(name).trim();
    if (!raw) return;
    // Resolve via a probe element to coerce var()/named colors to rgb().
    const probe = document.createElement("span");
    probe.style.color = raw;
    document.body.appendChild(probe);
    const rgb = parseColor(getComputedStyle(probe).color);
    probe.remove();
    if (rgb) out.push({ name, value: raw, lab: srgbToLab(rgb) });
  }
  for (const sheet of document.styleSheets) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      if (!rule.style) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        if (prop && prop.startsWith("--wb-color-")) tryPush(prop);
      }
    }
  }
  return out.map((c) => c.lab);
}

function measureActiveSlideInPage() {
  const active = document.querySelector(".wb-slide.active");
  if (!active) return null;

  const classes = Array.from(active.classList);
  const kindClass = classes.find((c) => c.startsWith("wb-slide--"));
  const kind = kindClass ? kindClass.slice("wb-slide--".length) : null;

  const inner = active.querySelector(".wb-slide-inner") || active;
  const sr = active.getBoundingClientRect();

  // Overflow scan: every descendant whose box extends past the slide bounds,
  // unless the element OR an ancestor up to the slide has overflow !== visible
  // (scrollable containers are intentionally allowed to clip).
  function isScrollableTo(el) {
    let cur = el;
    while (cur && cur !== active) {
      const ov = getComputedStyle(cur);
      if (ov.overflowX !== "visible" || ov.overflowY !== "visible") return true;
      cur = cur.parentElement;
    }
    return false;
  }
  function selectorFor(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length
      ? "." + Array.from(el.classList).slice(0, 2).join(".")
      : "";
    return `${tag}${id}${cls}`;
  }

  const overflows = [];
  const all = active.querySelectorAll("*");
  for (const el of all) {
    if (el.classList.contains("wb-slide-inner")) continue;
    if (isScrollableTo(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const right = Math.max(0, r.right - sr.right);
    const bottom = Math.max(0, r.bottom - sr.bottom);
    if (right > 1 || bottom > 1) {
      overflows.push({
        selector: selectorFor(el),
        right: Math.round(right),
        bottom: Math.round(bottom),
      });
      if (overflows.length >= 6) break; // cap per-slide noise
    }
  }

  // Demo fallback detection.
  const hasFallback = !!(
    active.querySelector(".wb-slide-fallback") ||
    active.querySelector("img, video") ||
    active.hasAttribute("data-fallback")
  );

  // Unstyled (empty).
  const innerText = (inner.innerText || "").trim();
  const elementChildren = Array.from(inner.children).filter(
    (c) => !!c.textContent || c.children.length > 0,
  );
  const empty = innerText.length === 0 && elementChildren.length === 0;

  // Drift color collection. We sample one rgb per (selector, prop) pair on
  // a bounded set of elements to keep the page-side payload small.
  function parseColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    const a = m[4] != null ? Number(m[4]) : 1;
    if (a < 0.05) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  function srgbToLab([R, G, B]) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = lin(R), g = lin(G), b = lin(B);
    const X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    const Z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
    const xn = X / 0.95047, yn = Y / 1.0, zn = Z / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(yn) - 16, 500 * (f(xn) - f(yn)), 200 * (f(yn) - f(zn))];
  }
  const driftColors = [];
  const driftSeen = new Set();
  // `color`/`background-color`/`border-color` are sampled on every
  // element; `fill`/`stroke` ONLY on SVG nodes. Every HTML element
  // has a computed `fill: rgb(0, 0, 0)` from the spec's SVG-inheritance
  // default — sampling it on HTML produces 22-warning false positives
  // where every slide reports "fill drifts from palette".
  const HTML_PROPS = ["color", "background-color", "border-color"];
  const SVG_PROPS = ["fill", "stroke"];
  const sampleEls = Array.from(all).slice(0, 250);
  for (const el of sampleEls) {
    const cs = getComputedStyle(el);
    const isSvg = el instanceof SVGElement;
    const props = isSvg ? [...HTML_PROPS, ...SVG_PROPS] : HTML_PROPS;
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      const rgb = parseColor(v);
      if (!rgb) continue;
      const key = `${p}:${rgb.join(",")}`;
      if (driftSeen.has(key)) continue;
      driftSeen.add(key);
      driftColors.push({
        selector: selectorFor(el),
        prop: p,
        value: v.trim(),
        lab: srgbToLab(rgb),
      });
      if (driftColors.length >= 60) break;
    }
    if (driftColors.length >= 60) break;
  }

  const normalizedText = innerText.replace(/\s+/g, " ").trim();
  return { kind, overflows, hasFallback, empty, driftColors, normalizedText };
}

// ────────────────────────────────────────────────────────────────────────────
// Node-side helpers.
// ────────────────────────────────────────────────────────────────────────────

function driftDeltaE(lab, palette) {
  // Min CIE76 ΔE between `lab` and any palette color.
  let min = Infinity;
  for (const p of palette) {
    const dL = lab[0] - p[0];
    const dA = lab[1] - p[1];
    const dB = lab[2] - p[2];
    const d = Math.sqrt(dL * dL + dA * dA + dB * dB);
    if (d < min) min = d;
  }
  return min;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Single-row DP for O(n) memory.
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function writePretty(artifact, findings, enabledRules, summary) {
  const isTTY = process.stdout.isTTY;
  const noColor = process.env.NO_COLOR != null && process.env.NO_COLOR !== "";
  const forceColor = process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true";
  const useColor = forceColor || (isTTY && !noColor);
  const C = useColor
    ? {
        red: (s) => `\x1b[31m${s}\x1b[0m`,
        yellow: (s) => `\x1b[33m${s}\x1b[0m`,
        green: (s) => `\x1b[32m${s}\x1b[0m`,
        bold: (s) => `\x1b[1m${s}\x1b[0m`,
        dim: (s) => `\x1b[2m${s}\x1b[0m`,
      }
    : { red: (s) => s, yellow: (s) => s, green: (s) => s, bold: (s) => s, dim: (s) => s };

  const rel = path.relative(process.cwd(), artifact) || artifact;
  process.stdout.write(`workbook check: ${C.bold(rel)}\n\n`);

  if (findings.length === 0) {
    process.stdout.write(`  ${C.green("PASS")}  no issues across ${enabledRules.length} rules\n\n`);
  } else {
    for (const f of findings) {
      const badge = f.severity === "fail" ? C.red("FAIL") : C.yellow("WARN");
      const kindStr = f.kind != null ? `kind=${f.kind}` : "kind=null";
      process.stdout.write(
        `  ${badge}  slide ${f.slide} (${kindStr}): ${f.message}  ${C.dim(f.rule)}\n`,
      );
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    `  Rules: ${enabledRules.join(", ")}\n` +
      `  Passed: ${summary.passed} rules · Failed: ${summary.failed} · Warnings: ${summary.warnings}\n\n`,
  );
}
