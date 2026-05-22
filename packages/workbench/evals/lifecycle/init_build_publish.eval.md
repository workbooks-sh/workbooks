---
name: lifecycle/init-build-publish
agent: workhorse
timeoutMs: 1500000
turns:
  - prompt: |
      Scaffold a new spa workbook for a daily-water-intake tracker
      (the directory should live at workbooks/water-intake-r5).
      Then build it. Then publish it so it has a workbooks.sh share URL.
      Wire enough UI that the tracker has at least one input control
      and one running-total display.
    checks:
      - kind: substrate.file_exists
        path: workbooks/water-intake-r5/workbook.config.mjs
      - kind: workbook.build
        workbookPath: workbooks/water-intake-r5
        probe:
          domSelectors:
            - 'script[type="module"]'
            - "input, button"
          noConsoleErrors: true
      - kind: workbook.publish
        workbookPath: workbooks/water-intake-r5
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if ALL of these are true:
          1. The response mentions a published / share URL (or the
             phrase "workbooks.sh/w/" appears).
          2. The response references the slug "water-intake-r5" OR the
             directory "workbooks/water-intake-r5".
          3. The response acknowledges the artifact was uploaded /
             published (verbs like "published", "uploaded",
             "shared" appear in context with the URL).

          Fail if ANY of these are true:
          - The response describes intent ("I'll publish it…") without
            evidence that publish completed.
          - The response is terse to the point of unverifiability
            ("done.", "published.").
          - The response refuses, says "I cannot publish", or proposes
            an alternative without performing the publish.
          - The response invents a fake share URL not matching the
            workbooks.sh/w/<id> pattern.
cleanup:
  - kind: substrate.remove_path
    path: workbooks/water-intake-r5
---

# lifecycle/init-build-publish

End-to-end smoke for the author-to-public-URL loop. One sentence in,
one share URL out. The agent has to:

- pick a slug + scaffold from a template
- author enough UI that the build-probe passes (a real input + display,
  not an empty `<html></html>`)
- run `workbook build`
- run `workbook publish` and surface the resulting workbooks.sh URL

Gates:

- `substrate.file_exists` proves the project landed in the substrate.
- `workbook.build` proves the artifact compiles AND probes for real
  UI (input + button selectors — empty shells fail the probe per
  the wb-xpgr.4.4 audit).
- `workbook.publish` is the load-bearing one: the action spawns
  `workbook publish` and refuses to pass unless it can parse a
  real id from the broker's revoke line in stdout. An agent that
  fabricates "https://workbooks.sh/w/fake-id" in its response
  without actually running publish will fail here — the action
  doesn't read the agent's text, it shells out itself.

Rubric is rubric, not gate: it only sees the assistant text, so it's
charitable by construction. Real authentication comes from the
`workbook.publish` gate above.

CAUTION: this spec writes to public state at workbooks.sh. Every
green run leaves a published artifact behind. Operator should keep
`workbook publish --revoke <id>` close at hand for cleanup, OR run
under a throwaway broker (WORKBOOKS_BROKER pointed at a dev
instance).

The published id is observable via `ctx.lastPublishedId` after this
spec runs — the next spec (`published_roundtrip`) chains off it
when both are run in the same suite invocation (specs do NOT share
ctx across files today, so the round-trip spec sets up its own
publish).
