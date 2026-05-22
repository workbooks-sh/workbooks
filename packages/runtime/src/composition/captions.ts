// Caption loader + frame-keyed lookup.
//
// CW XML lets authors declare a transcript analysis at the document
// root:
//
//   <analysis>
//     <transcript id="t1" src="./transcript.words.json" />
//   </analysis>
//
// …and then attach captions to a shot:
//
//   <caption source="t1" mode="word-highlight" anchor="lower-third" />
//
// The runtime fetches the JSON (or VTT), normalises to a flat
// AudioWord[] keyed in milliseconds, caches by absolute URL, and
// provides `wordsAtFrame()` to read the active word/line for a given
// playhead frame. Word-highlight mode emphasises one word at a time;
// line mode shows the active sentence with no per-word emphasis.

import type { AnalysisRef, CwXmlDocument } from "@work.books/cw-xml";

/** One transcribed word with start / end times in milliseconds. */
export interface AudioWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** A group of contiguous words — used for `line` mode. */
export interface AudioSegment {
  startMs: number;
  endMs: number;
  words: AudioWord[];
}

/** What `wordsAtFrame` returns for a given frame. */
export interface CaptionFrameState {
  /** All words in the rolling window (≤8 for word-highlight). */
  visibleWords: AudioWord[];
  /** Index of the currently-spoken word within `visibleWords`. -1 if none. */
  activeIndex: number;
  /** The full sentence containing the active word (line mode). */
  line: string;
}

type LoadState =
  | { kind: "pending"; promise: Promise<AudioWord[]> }
  | { kind: "ready"; words: AudioWord[] }
  | { kind: "error"; error: string };

const cache = new Map<string, LoadState>();

/** Test-only: drop the in-memory cache. */
export function __resetCaptionCache(): void {
  cache.clear();
}

/**
 * Resolve the analysis ref in the document to its absolute URL,
 * relative to `baseUrl`. Returns null if the analysis id is unknown
 * or not a transcript.
 */
export function resolveAnalysisUrl(
  doc: CwXmlDocument,
  analysisId: string,
  baseUrl: string | null,
): string | null {
  const ref = doc.analysis.find((a) => a.id === analysisId);
  if (!ref || ref.kind !== "transcript") return null;
  if (!ref.src) return null;
  if (!baseUrl) return ref.src;
  try {
    return new URL(ref.src, new URL(baseUrl, window.location.href)).toString();
  } catch {
    return ref.src;
  }
}

/**
 * Fetch (or retrieve from cache) the words for an analysis ref. The
 * returned promise resolves to a flat AudioWord[]. Errors surface as
 * an empty array — the caller decides whether to surface the error.
 */
export function loadTranscript(url: string): Promise<AudioWord[]> {
  const cached = cache.get(url);
  if (cached) {
    if (cached.kind === "ready") return Promise.resolve(cached.words);
    if (cached.kind === "pending") return cached.promise;
    if (cached.kind === "error") return Promise.resolve([]);
  }
  const promise = fetchAndParse(url).then((words) => {
    cache.set(url, { kind: "ready", words });
    return words;
  }).catch((err) => {
    cache.set(url, { kind: "error", error: String(err) });
    return [];
  });
  cache.set(url, { kind: "pending", promise });
  return promise;
}

/**
 * Inject pre-loaded words for an analysis URL — used when the
 * caller already has the transcript (e.g. inlined as a `?raw` import
 * in the single-file artifact).
 */
export function injectTranscript(url: string, words: AudioWord[]): void {
  cache.set(url, { kind: "ready", words });
}

async function fetchAndParse(url: string): Promise<AudioWord[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`captions fetch ${url} → ${res.status}`);
  const text = await res.text();
  if (url.toLowerCase().endsWith(".vtt") || text.trimStart().startsWith("WEBVTT")) {
    return parseVtt(text);
  }
  return parseJson(text);
}

/**
 * Parse either:
 *   - AudioWord[] — flat list of `{ text, start_ms, end_ms }`
 *   - AudioSegment[] — `[{ start_ms, end_ms, words: [...] }]`
 *
 * Accepts both snake_case and camelCase keys for resilience.
 */
export function parseJson(text: string): AudioWord[] {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) return [];
  if (data.length === 0) return [];
  // Segment shape has a `words` array; flat shape has `text`.
  if (typeof (data[0] as any).words !== "undefined") {
    const out: AudioWord[] = [];
    for (const seg of data as AudioSegment[]) {
      for (const w of (seg as any).words ?? []) {
        out.push(normaliseWord(w));
      }
    }
    return out;
  }
  return (data as any[]).map(normaliseWord);
}

function normaliseWord(w: any): AudioWord {
  return {
    text: String(w.text ?? ""),
    startMs: Number(w.start_ms ?? w.startMs ?? 0),
    endMs: Number(w.end_ms ?? w.endMs ?? 0),
  };
}

/**
 * Minimal WebVTT parser. Doesn't support cue identifiers, regions, or
 * styling — just `HH:MM:SS.mmm --> HH:MM:SS.mmm` cue blocks. Each cue
 * becomes a single AudioWord whose `text` is the cue payload joined
 * with spaces (the caller can split if needed).
 */
export function parseVtt(text: string): AudioWord[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: AudioWord[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(
      /^(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/,
    );
    if (m) {
      const startMs = vttToMs(m[1], m[2], m[3], m[4]);
      const endMs = vttToMs(m[5], m[6], m[7], m[8]);
      i++;
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().length > 0) {
        buf.push(lines[i].trim());
        i++;
      }
      out.push({ text: buf.join(" "), startMs, endMs });
    }
    i++;
  }
  return out;
}

function vttToMs(hh: string | undefined, mm: string, ss: string, ms: string): number {
  const h = hh ? Number(hh.replace(":", "")) : 0;
  return h * 3600_000 + Number(mm) * 60_000 + Number(ss) * 1000 + Number(ms);
}

/**
 * Caption rendering mode.
 *
 * Canonical shorthands:
 *   - "word-highlight" — rolling 8-word window, active word highlighted
 *   - "line" — full sentence containing the active word, no per-word emphasis
 *
 * Anything else is treated as a `"custom"` mode: the runtime emits the
 * full active sentence + the per-word state, and the author handles
 * presentation themselves via `class=` / `style=` on the caption
 * container plus CSS targeted at `[data-mode="<their-value>"]`.
 */
export type CaptionMode = string;

/**
 * Look up the active caption state at `playheadFrame`. Returns an
 * empty state if the words haven't loaded yet. Unknown modes fall
 * through to a sentence-window aggregation so the agent's CSS has
 * something to render — they're never silently dropped.
 */
export function wordsAtFrame(
  words: AudioWord[],
  playheadFrame: number,
  fps: number,
  mode: CaptionMode,
): CaptionFrameState {
  if (words.length === 0) {
    return { visibleWords: [], activeIndex: -1, line: "" };
  }
  const ms = (playheadFrame / Math.max(1, fps)) * 1000;
  let activeIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (ms >= words[i].startMs && ms < words[i].endMs) {
      activeIndex = i;
      break;
    }
  }
  if (activeIndex === -1) {
    // No exact match — fall back to the most recently completed word
    // so a stale caption stays on screen during pauses between words.
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i].endMs <= ms) {
        activeIndex = i;
        break;
      }
    }
  }

  if (activeIndex === -1) {
    return { visibleWords: [], activeIndex: -1, line: "" };
  }

  if (mode === "word-highlight") {
    // Rolling window of up to 8 words centered on the active one,
    // biased so the active word sits two thirds in.
    const WINDOW = 8;
    const before = Math.min(activeIndex, Math.floor((WINDOW * 2) / 3));
    const start = Math.max(0, activeIndex - before);
    const end = Math.min(words.length, start + WINDOW);
    const slice = words.slice(start, end);
    return {
      visibleWords: slice,
      activeIndex: activeIndex - start,
      line: slice.map((w) => w.text).join(" "),
    };
  }

  // Default to sentence-window aggregation. Covers `mode="line"` AND
  // any custom mode the author defined — they get the full sentence
  // plus per-word activity and decide what to do with it via CSS.
  const { startIdx, endIdx } = sentenceRange(words, activeIndex);
  const slice = words.slice(startIdx, endIdx + 1);
  return {
    visibleWords: slice,
    activeIndex: activeIndex - startIdx,
    line: slice.map((w) => w.text).join(" "),
  };
}

function sentenceRange(words: AudioWord[], i: number): { startIdx: number; endIdx: number } {
  const TERMINATORS = /[.!?]$/;
  let startIdx = i;
  while (startIdx > 0 && !TERMINATORS.test(words[startIdx - 1].text)) {
    startIdx--;
  }
  let endIdx = i;
  while (endIdx < words.length - 1 && !TERMINATORS.test(words[endIdx].text)) {
    endIdx++;
  }
  return { startIdx, endIdx };
}

/** Pulled out so tests can drive the loader without touching `fetch`. */
export const __testing = {
  parseJson,
  parseVtt,
  wordsAtFrame,
  cache,
};

export type { AnalysisRef };
