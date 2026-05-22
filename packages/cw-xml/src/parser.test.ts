// Smoke test against the canonical `footage-hybrid.xml` fixture from
// the Rust crate. Round-trips through the TS parser + timeline
// resolver. Run with `bun test`.

import { describe, expect, test } from "bun:test";
import { parseDocument } from "./parser";
import { resolveTimeline, entriesAtFrame } from "./timeline";
import { parseTime } from "./time";

// DOMParser is provided by Bun's happy-dom integration; fall back to
// linkedom if we're running in a Node-only context.
if (typeof DOMParser === "undefined") {
  const { DOMParser: LinkedomDOMParser } = await import("linkedom").catch(() => ({}) as any);
  if (LinkedomDOMParser) {
    (globalThis as any).DOMParser = LinkedomDOMParser;
  } else {
    // Hand-roll a minimal DOMParser shim using Bun's HTMLRewriter is
    // overkill for this smoke test. If linkedom isn't installed we
    // print a hint and skip.
    console.warn("[cw-xml/parser.test] no DOMParser available; install linkedom or run via Bun --dom");
  }
}

const FOOTAGE_HYBRID = `<cw-xml version="0.1" fps="30" resolution="1920x1080" aspect="16:9">
  <assets>
    <asset id="interview-a" kind="video" src="fixtures/interview-a.mp4" />
    <asset id="logo" kind="image" src="fixtures/logo.png" />
  </assets>
  <analysis>
    <transcript id="interview-transcript" asset="interview-a" src="analysis/transcript.words.json" />
    <faces id="interview-faces" asset="interview-a" src="analysis/faces.json" />
  </analysis>
  <exports>
    <export id="landscape" aspect="16:9" backend="hybrid" />
    <export id="social" aspect="9:16" backend="ffmpeg" />
  </exports>
  <sequence id="main" duration="8s">
    <scene id="proof" duration="8s" composition="rule-of-thirds-subject">
      <shot id="best-answer" duration="5s" composition="lower-third-caption">
        <clip id="answer-a" asset="interview-a" in="00:04:12:08" out="00:04:17:08" sync="audio" />
        <caption id="answer-captions" source="interview-transcript" mode="word-highlight" anchor="lower-third" safe="title" />
        <layer id="lower-third" kind="text" role="caption" anchor="lower-third" safe="title">
          <text>Founder explains the shift.</text>
        </layer>
        <animation id="lower-third-in" subject="lower-third" intent="reveal" principle="staging" direction="up" start="12f" duration="18f" />
        <transition-in kind="fade" duration="8f" />
        <transition-out kind="fade" duration="10f" />
      </shot>
      <shot id="brand-payoff" duration="3s" composition="centered-title">
        <layer id="logo-mark" kind="image" role="hero" anchor="center" safe="action" />
        <layer id="payoff-line" kind="text" role="title" anchor="center" safe="title">
          <text>Cut from evidence.</text>
        </layer>
        <transition-in kind="fade" duration="10f" />
      </shot>
    </scene>
  </sequence>
</cw-xml>`;

describe("parseTime", () => {
  test("frames", () => {
    expect(parseTime("12f", 30).frames).toBe(12);
  });
  test("whole seconds", () => {
    expect(parseTime("5s", 30).frames).toBe(150);
  });
  test("timecode", () => {
    expect(parseTime("00:04:12:08", 30).frames).toBe(((4 * 60) + 12) * 30 + 8);
  });
  test("rejects fractional seconds that don't land on a frame", () => {
    // 0.01s at 30fps = 0.3 frames — not whole
    expect(() => parseTime("0.01s", 30)).toThrow();
  });
  test("accepts 0.5s at 30fps (15 frames)", () => {
    expect(parseTime("0.5s", 30).frames).toBe(15);
  });
  test("accepts 0.1s at 30fps (3 frames)", () => {
    expect(parseTime("0.1s", 30).frames).toBe(3);
  });
});

const hasDom = typeof DOMParser !== "undefined";
const maybeTest = hasDom ? test : test.skip;

describe("parseDocument", () => {
  maybeTest("parses footage-hybrid root attrs", () => {
    const doc = parseDocument(FOOTAGE_HYBRID);
    expect(doc.fps).toBe(30);
    expect(doc.resolution).toEqual({ width: 1920, height: 1080 });
    expect(doc.aspect).toBe("16:9");
    expect(doc.assets).toHaveLength(2);
    expect(doc.assets[0].id).toBe("interview-a");
    expect(doc.analysis).toHaveLength(2);
    expect(doc.exports).toHaveLength(2);
    expect(doc.sequences).toHaveLength(1);
    const seq = doc.sequences[0];
    expect(seq.scenes).toHaveLength(1);
    expect(seq.scenes[0].shots).toHaveLength(2);
  });

  maybeTest("preserves layer text content", () => {
    const doc = parseDocument(FOOTAGE_HYBRID);
    const shot = doc.sequences[0].scenes[0].shots[0];
    const lowerThird = shot.layers.find((l) => l.id === "lower-third");
    expect(lowerThird?.text).toBe("Founder explains the shift.");
  });

  maybeTest("captures transition-in and transition-out phases", () => {
    const doc = parseDocument(FOOTAGE_HYBRID);
    const shot = doc.sequences[0].scenes[0].shots[0];
    const phases = shot.transitions.map((t) => t.phase).sort();
    expect(phases).toEqual(["in", "out"]);
  });
});

describe("resolveTimeline", () => {
  maybeTest("computes absolute frames at 30fps", () => {
    const doc = parseDocument(FOOTAGE_HYBRID);
    const timeline = resolveTimeline(doc);
    expect(timeline.duration.frames).toBe(8 * 30); // 8s
    const [seq] = timeline.sequences;
    expect(seq.startFrame).toBe(0);
    expect(seq.endFrame).toBe(240);
    const [scene] = seq.scenes;
    expect(scene.startFrame).toBe(0);
    expect(scene.endFrame).toBe(240);
    const [shot1, shot2] = scene.shots;
    expect(shot1.startFrame).toBe(0);
    expect(shot1.endFrame).toBe(5 * 30);
    expect(shot2.startFrame).toBe(5 * 30);
    expect(shot2.endFrame).toBe(8 * 30);
  });

  maybeTest("entries-at-frame returns the active shot's composition", () => {
    const doc = parseDocument(FOOTAGE_HYBRID);
    const timeline = resolveTimeline(doc);
    const active = entriesAtFrame(timeline, 30); // 1s in → first shot
    const shot = active.find((e) => e.source === "shot");
    expect(shot?.id).toBe("best-answer");
    expect(shot?.composition).toBe("lower-third-caption");

    const lateActive = entriesAtFrame(timeline, 6 * 30); // 6s in → second shot
    const lateShot = lateActive.find((e) => e.source === "shot");
    expect(lateShot?.id).toBe("brand-payoff");
  });

  maybeTest("transition-out lands at end of shot", () => {
    const doc = parseDocument(FOOTAGE_HYBRID);
    const timeline = resolveTimeline(doc);
    const shot = timeline.sequences[0].scenes[0].shots[0];
    const out = shot.transitions.find((t) => t.phase === "out");
    expect(out?.startFrame).toBe(5 * 30 - 10);
    expect(out?.endFrame).toBe(5 * 30);
  });
});
