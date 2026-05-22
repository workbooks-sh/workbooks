// One-shot smoke that invokes the gemini-backed rubric.passes against
// a known mp4 + a tiny rubric. Not part of the unit-test suite —
// requires GOOGLE_API_KEY and makes a real Gemini API call.
//
// Usage: node test/eval-rubric-gemini.smoke.mjs <path/to/commercial.mp4>

import { rubricChecks } from "../src/eval/checks/rubric.mjs";

const mp4 = process.argv[2];
if (!mp4) {
  console.error("usage: node eval-rubric-gemini.smoke.mjs <mp4-path>");
  process.exit(2);
}
if (!process.env.GOOGLE_API_KEY) {
  console.error("GOOGLE_API_KEY not set");
  process.exit(2);
}

const ctx = {
  events: [],
  // The rubric falls back to text-only target via assistant_text;
  // empty events + no transcript means it'll use whatever empty-string
  // fallback there is. We mainly want to confirm the gemini codepath.
  gamutCommercialMp4: mp4,
  gamutTranscript: null,
};

const rubric = `
You are evaluating a 5-second coffee-product commercial.

Pass if ALL of these are true:
1. The video plays and shows recognizable subject matter
   (coffee carafe, pouring, cups, hands — not a black frame
   or a test pattern).
2. The overall composition is intentional — framing, motion,
   timing all look like a deliberate shot, not random noise.

Fail if ANY of these are true:
- The video is mostly black, blank, glitchy, or shows obvious
  rendering artifacts.
- The video contains nothing recognizably coffee-related.
- The motion is absent or chaotic.
`;

const params = {
  target: "none",                  // video is the primary evidence
  rubric,
  minScore: 0.5,
  attachments: { mp4_path: mp4 },
  judge: "gemini",                 // force gemini even if API key not auto-detected
};

const start = Date.now();
const result = await rubricChecks["rubric.passes"](ctx, params);
const elapsed = Date.now() - start;
console.log(JSON.stringify({ result, elapsed_ms: elapsed }, null, 2));
process.exit(result.ok ? 0 : 1);
