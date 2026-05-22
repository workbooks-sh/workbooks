// DOMParser-based CW XML → IR. Browser-only by design; the Rust crate
// uses `roxmltree` server-side. Validation is light here: missing
// required attrs surface during timeline resolution rather than at
// parse time, mirroring the Rust crate's "parse permissively, validate
// at resolve" split.

import {
  CwXmlError,
  type AdjustmentDecl,
  type AdjustmentRef,
  type AnalysisRef,
  type Animation,
  type Asset,
  type AudioCue,
  type AudioDecl,
  type Caption,
  type Clip,
  type Constraint,
  type CwXmlDocument,
  type ExportTarget,
  type Layer,
  type Resolution,
  type Scene,
  type Sequence,
  type Shot,
  type Transition,
  type TransitionPhase,
  type UnsupportedElement,
  type VisualAttrs,
} from "./types";

const SHOT_RAW_ELEMENTS = new Set(["html", "css", "script", "style", "div", "span"]);

const ALLOWED_CHILDREN: Record<string, ReadonlySet<string>> = {
  "cw-xml": new Set([
    "assets", "analysis", "exports", "sequence", "audios", "adjustments",
  ]),
  assets: new Set(["asset"]),
  analysis: new Set([
    "transcript", "speakers", "ocr", "faces", "saliency",
    "segmentation", "depth", "silence", "storyboard", "beat-grid", "music",
  ]),
  exports: new Set(["export"]),
  audios: new Set(["audio"]),
  adjustments: new Set(["adjustment"]),
  sequence: new Set(["scene"]),
  scene: new Set(["shot"]),
  shot: new Set([
    "clip", "layer", "caption", "constraint", "animation",
    "transition-in", "transition-out", "audio", "adjustment",
  ]),
  layer: new Set(["text"]),
};

export function parseDocument(xml: string): CwXmlDocument {
  if (typeof DOMParser === "undefined") {
    throw new CwXmlError("DOMParser is not available — cw-xml parser is browser-only");
  }
  const parser = new DOMParser();
  const dom = parser.parseFromString(xml, "application/xml");
  const errorNode = dom.querySelector("parsererror");
  if (errorNode) {
    throw new CwXmlError(`XML parse failed: ${errorNode.textContent ?? "unknown"}`);
  }
  const root = dom.documentElement;
  if (!root || root.tagName !== "cw-xml") {
    throw new CwXmlError(
      `expected <cw-xml> root, got <${root?.tagName ?? "nothing"}>`,
    );
  }

  const unsupportedElements: UnsupportedElement[] = [];
  collectUnsupported(root, "cw-xml", unsupportedElements);

  return {
    version: attr(root, "version"),
    fps: parseUint(root.getAttribute("fps")),
    resolution: parseResolution(root.getAttribute("resolution")),
    aspect: attr(root, "aspect"),
    assets: childrenNamed(root, "assets").flatMap((el) =>
      childrenNamed(el, "asset").map(parseAsset),
    ),
    analysis: childrenNamed(root, "analysis").flatMap((el) =>
      elementChildren(el).map(parseAnalysisRef),
    ),
    exports: childrenNamed(root, "exports").flatMap((el) =>
      childrenNamed(el, "export").map(parseExport),
    ),
    audios: childrenNamed(root, "audios").flatMap((el) =>
      childrenNamed(el, "audio").map(parseAudioDecl),
    ),
    adjustments: childrenNamed(root, "adjustments").flatMap((el) =>
      childrenNamed(el, "adjustment").map(parseAdjustmentDecl),
    ),
    sequences: childrenNamed(root, "sequence").map(parseSequence),
    unsupportedElements,
  };
}

/** Pull `class=` / `style=` off any element. */
function parseVisualAttrs(node: Element): VisualAttrs {
  const v: VisualAttrs = {};
  const cls = attr(node, "class");
  if (cls) v.class = cls;
  const style = attr(node, "style");
  if (style) v.style = style;
  return v;
}

function parseAudioDecl(node: Element): AudioDecl {
  return {
    id: attrOrEmpty(node, "id"),
    src: attrOrEmpty(node, "src"),
    kind: attr(node, "kind"),
    volume: parseFloatAttr(node, "volume"),
    loop: parseBoolAttr(node, "loop"),
    pan: parseFloatAttr(node, "pan"),
  };
}

function parseAudioCue(node: Element): AudioCue {
  return {
    ref: attr(node, "ref") ?? attrOrEmpty(node, "id"),
    start: attr(node, "start"),
    duration: attr(node, "duration"),
    volume: parseFloatAttr(node, "volume"),
    duck: parseFloatAttr(node, "duck"),
    fadeIn: parseFloatAttr(node, "fade-in") ?? parseFloatAttr(node, "fadeIn"),
    fadeOut: parseFloatAttr(node, "fade-out") ?? parseFloatAttr(node, "fadeOut"),
    pan: parseFloatAttr(node, "pan"),
  };
}

function parseAdjustmentDecl(node: Element): AdjustmentDecl {
  return {
    id: attrOrEmpty(node, "id"),
    filter: attrOrEmpty(node, "filter"),
    backdrop: attr(node, "backdrop"),
    blend: attr(node, "blend"),
  };
}

function parseAdjustmentRef(node: Element): AdjustmentRef {
  return {
    ref: attr(node, "ref"),
    filter: attr(node, "filter"),
    backdrop: attr(node, "backdrop"),
    blend: attr(node, "blend"),
  };
}

function parseAsset(node: Element): Asset {
  return {
    id: attrOrEmpty(node, "id"),
    kind: attrOrEmpty(node, "kind"),
    src: attrOrEmpty(node, "src"),
  };
}

function parseAnalysisRef(node: Element): AnalysisRef {
  return {
    id: attr(node, "id") ?? node.tagName,
    kind: attr(node, "kind") ?? node.tagName,
    asset: attr(node, "asset"),
    src: attrOrEmpty(node, "src"),
  };
}

function parseExport(node: Element): ExportTarget {
  return {
    id: attr(node, "id") ?? attr(node, "aspect") ?? "main",
    aspect: attrOrEmpty(node, "aspect"),
    backend: attr(node, "backend") ?? "hybrid",
  };
}

function parseSequence(node: Element): Sequence {
  return {
    id: attrOrEmpty(node, "id"),
    duration: attr(node, "duration"),
    scenes: childrenNamed(node, "scene").map(parseScene),
  };
}

function parseScene(node: Element): Scene {
  return {
    id: attrOrEmpty(node, "id"),
    duration: attr(node, "duration"),
    composition: attr(node, "composition"),
    shots: childrenNamed(node, "shot").map(parseShot),
  };
}

function parseShot(node: Element): Shot {
  const transitions: Transition[] = [];
  for (const child of elementChildren(node)) {
    if (child.tagName === "transition-in") transitions.push(parseTransition(child, "in"));
    else if (child.tagName === "transition-out") transitions.push(parseTransition(child, "out"));
  }
  return {
    ...parseVisualAttrs(node),
    id: attrOrEmpty(node, "id"),
    duration: attr(node, "duration"),
    composition: attr(node, "composition"),
    clips: childrenNamed(node, "clip").map(parseClip),
    layers: childrenNamed(node, "layer").map(parseLayer),
    captions: childrenNamed(node, "caption").map(parseCaption),
    constraints: childrenNamed(node, "constraint").map(parseConstraint),
    animations: childrenNamed(node, "animation").map(parseAnimation),
    transitions,
    audios: childrenNamed(node, "audio").map(parseAudioCue),
    adjustments: childrenNamed(node, "adjustment").map(parseAdjustmentRef),
  };
}

function parseClip(node: Element): Clip {
  const asset = attrOrEmpty(node, "asset");
  return {
    ...parseVisualAttrs(node),
    id: attr(node, "id") ?? (asset ? `${asset}-clip` : ""),
    asset,
    start: attr(node, "start"),
    duration: attr(node, "duration"),
    in: attr(node, "in"),
    out: attr(node, "out"),
    sync: attr(node, "sync"),
    filter: attr(node, "filter"),
    adjustment: attr(node, "adjustment"),
  };
}

function parseCaption(node: Element): Caption {
  return {
    ...parseVisualAttrs(node),
    id: attr(node, "id") ?? attrOrEmpty(node, "source"),
    source: attrOrEmpty(node, "source"),
    mode: attr(node, "mode"),
    anchor: attr(node, "anchor"),
    safe: attr(node, "safe"),
  };
}

function parseConstraint(node: Element): Constraint {
  return {
    id: attr(node, "id") ?? attrOrEmpty(node, "kind"),
    kind: attrOrEmpty(node, "kind"),
    target: attr(node, "target"),
    value: attr(node, "value"),
  };
}

function parseLayer(node: Element): Layer {
  const textChild = childrenNamed(node, "text")[0];
  return {
    ...parseVisualAttrs(node),
    id: attrOrEmpty(node, "id"),
    kind: attrOrEmpty(node, "kind"),
    role: attr(node, "role"),
    anchor: attr(node, "anchor"),
    safe: attr(node, "safe"),
    src: attr(node, "src"),
    start: attr(node, "start"),
    duration: attr(node, "duration"),
    text: textChild?.textContent?.trim() || undefined,
    filter: attr(node, "filter"),
    adjustment: attr(node, "adjustment"),
  };
}

function parseAnimation(node: Element): Animation {
  const phaseAttr = attr(node, "phase");
  return {
    ...parseVisualAttrs(node),
    id: attrOrEmpty(node, "id"),
    subject: attrOrEmpty(node, "subject"),
    intent: attrOrEmpty(node, "intent"),
    principle: attr(node, "principle"),
    direction: attr(node, "direction"),
    start: attr(node, "start"),
    duration: attr(node, "duration"),
    easing: attr(node, "easing"),
    from: attr(node, "from"),
    to: attr(node, "to"),
    vars: attr(node, "vars"),
    phase: phaseAttr === "out" ? "out" : phaseAttr === "in" ? "in" : undefined,
  };
}

function parseTransition(node: Element, phase: TransitionPhase): Transition {
  return {
    ...parseVisualAttrs(node),
    id: attr(node, "id"),
    phase,
    kind: attrOrEmpty(node, "kind"),
    duration: attr(node, "duration"),
    direction: attr(node, "direction"),
    easing: attr(node, "easing"),
    from: attr(node, "from"),
    to: attr(node, "to"),
  };
}

function parseFloatAttr(node: Element, name: string): number | undefined {
  const v = node.getAttribute(name);
  if (v === null) return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

function parseBoolAttr(node: Element, name: string): boolean | undefined {
  const v = node.getAttribute(name);
  if (v === null) return undefined;
  const t = v.trim().toLowerCase();
  if (t === "" || t === "true" || t === "1" || t === name) return true;
  if (t === "false" || t === "0") return false;
  return undefined;
}

function collectUnsupported(node: Element, context: string, out: UnsupportedElement[]): void {
  for (const child of elementChildren(node)) {
    const name = child.tagName;
    if (SHOT_RAW_ELEMENTS.has(name) || !isAllowedChild(node.tagName, name)) {
      out.push({ name, context });
    }
    collectUnsupported(child, child.getAttribute("id") ?? name, out);
  }
}

function isAllowedChild(parent: string, child: string): boolean {
  const set = ALLOWED_CHILDREN[parent];
  return set ? set.has(child) : false;
}

function elementChildren(node: Element): Element[] {
  return Array.from(node.children);
}

function childrenNamed(node: Element, name: string): Element[] {
  return elementChildren(node).filter((c) => c.tagName === name);
}

function attr(node: Element, name: string): string | undefined {
  const v = node.getAttribute(name);
  if (v === null) return undefined;
  return v.trim();
}

function attrOrEmpty(node: Element, name: string): string {
  return attr(node, name) ?? "";
}

function parseUint(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value.trim())) return undefined;
  return Number(value);
}

function parseResolution(value: string | null): Resolution | undefined {
  if (value === null) return undefined;
  const m = value.match(/^(\d+)x(\d+)$/);
  if (!m) return undefined;
  return { width: Number(m[1]), height: Number(m[2]) };
}
