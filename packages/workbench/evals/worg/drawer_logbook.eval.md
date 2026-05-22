---
name: worg/drawer-logbook
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write to /task.org:

          * NEXT Investigate the failing payment webhook
          :PROPERTIES:
          :ID: payment-webhook
          :END:
          :LOGBOOK:
          - Note taken on [2026-05-20 Tue]: First seen failures around 14:00 UTC.
          :END:

      Now you've done a round of investigation. Append a NEW entry to
      the :LOGBOOK: drawer of payment-webhook with your finding:

          - Note taken on [2026-05-21 Wed]: Root cause is duplicate
            idempotency key on retry. Fix in middleware.

      Use worg_mutate to update the drawer (op: "append_drawer" or
      whichever the surface exposes; if necessary, fall back to
      read + modify + write).

      After updating, read /task.org and confirm BOTH log entries are
      present. Reply with "LOGBOOK_APPENDED" + a one-line summary.
    checks:
      - kind: session.text_contains
        substring: LOGBOOK_APPENDED
      - kind: session.text_contains
        substring: "idempotency"
      - kind: session.text_contains
        substring: "2026-05-20"
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if:
          1. Both log entries (2026-05-20 first-seen + 2026-05-21
             root-cause) appear or are described as present in the
             final file.
          2. The drawer structure (:LOGBOOK: ... :END:) was preserved,
             not broken or duplicated.

          Fail if the original entry was overwritten or if the file
          ends with a malformed drawer.
---

# worg/drawer-logbook

Drawers are the "decision context co-located with work" mechanism.
:LOGBOOK: in particular is the audit-trail anchor that Linear-skeptics
want preserved when agents act on tasks. This gate verifies an agent
can append to a drawer without breaking its structure — the same
operation a human would do when adding notes to a ticket.
