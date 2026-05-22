---
name: lifecycle/published-roundtrip
agent: workhorse
timeoutMs: 600000
setup:
  - kind: substrate.write_path
    path: workbooks/roundtrip-r5/workbook.config.mjs
    content: |
      export default {
        name: "Roundtrip R5",
        slug: "roundtrip-r5",
        type: "spa",
        entry: "src/index.html",
      };
  - kind: substrate.write_path
    path: workbooks/roundtrip-r5/src/index.html
    content: |
      <!doctype html>
      <html>
        <body>
          <h1 data-fixture-marker="roundtrip-r5-3f9c2e">roundtrip fixture</h1>
          <script type="module" src="./main.js"></script>
        </body>
      </html>
  - kind: substrate.write_path
    path: workbooks/roundtrip-r5/src/main.js
    content: |
      // sha256-anchor sentinel: 3f9c2e-roundtrip-r5
      // any change to this comment changes the bundle hash, so
      // substrate.bytes_equal fails fast if the round-trip drops a byte.
      const totalEl = document.querySelector("[data-fixture-marker]");
      console.log("marker:", totalEl?.textContent ?? "(missing)");
  - kind: workbook.build
    workbookPath: workbooks/roundtrip-r5
    probe: false
  - kind: workbook.publish
    workbookPath: workbooks/roundtrip-r5
  - kind: workbook.pull
    slug: roundtrip-r5
turns:
  - checks:
      - kind: substrate.bytes_equal
        left: workbooks/roundtrip-r5/src/main.js
        right: ctx.lastPulledDir:src/main.js
      - kind: substrate.bytes_equal
        left: workbooks/roundtrip-r5/src/index.html
        right: ctx.lastPulledDir:src/index.html
      - kind: substrate.file_contains
        path: workbooks/roundtrip-r5/src/main.js
        substring: "3f9c2e-roundtrip-r5"
cleanup:
  - kind: substrate.remove_path
    path: workbooks/roundtrip-r5
---

# lifecycle/published-roundtrip

Source bundle round-trip integrity. The eval has NO agent turn: it
exercises the framework's own publish + pull pipeline and checks that
the source tree the recipient unbundles is byte-equal to what the
author published.

Setup chain (all gates):

1. Write a fixture workbook (config + index.html + main.js) into the
   substrate. `main.js` carries an anchor comment (`3f9c2e-roundtrip-r5`)
   — any single-byte drift through gzip → base64 → publish → pull →
   decode breaks the substrate.bytes_equal gate.
2. `workbook.build` produces dist/roundtrip-r5.html in the substrate
   clone. `probe: false` because the fixture has no JS-runtime work
   to verify (the rubric'd version of probe would need puppeteer).
3. `workbook.publish` uploads to workbooks.sh; sets
   ctx.lastPublishedId.
4. `workbook.pull` re-downloads into a fresh tempdir; sets
   ctx.lastPulledDir.

Turn 1 is check-only:

- `substrate.bytes_equal` on `main.js` (substrate ↔ pulled tempdir):
  sha256 of the original byte sequence must equal sha256 of the
  pulled byte sequence. Single-byte drift = fail.
- `substrate.bytes_equal` on `index.html`: covers the entry file too,
  so a regression that only affected one file type would still surface.
- `substrate.file_contains` on the anchor comment: belt-and-suspenders
  pin. If the substrate's own copy of main.js silently mutates (e.g. a
  newline-normalization regression in `substrate.write_path`), this
  catches it before bytes_equal returns a false positive against a
  drifted "original".

Audit consideration: this spec passes if `workbook publish` + `workbook
pull` are no-ops that return the bytes unchanged. That's fine — that
IS the contract being tested. Exploit risk is the reverse: an
implementation that always returns the published bytes from a local
cache without round-tripping through the broker would pass too. Future
hardening: add a second pull from a clean machine / cleared cache; for
now the cli's `workbook pull` always re-fetches from the broker, so
this is sufficient.

CAUTION: writes to public state. Every green run leaves a
`roundtrip-r5` artifact at workbooks.sh. Operator must revoke
manually (`workbook publish --revoke <id>` — id is in the eval log)
or run under a throwaway broker.
