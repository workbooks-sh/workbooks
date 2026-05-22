---
name: worg/mutate-properties
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      Write to /work.org:

          * NEXT Ship pricing page redesign
          :PROPERTIES:
          :ID: pricing-redesign
          :ESTIMATE: 3d
          :END:

      Use worg_mutate to update the properties:
        - change ESTIMATE from "3d" to "5d"
        - add OWNER: alice
        - add SUCCESS_CRITERIA: "passes lighthouse > 90 + designer signoff"

      After the mutation, read the file and confirm all three property
      values are present. Reply with: "PROPS_UPDATED" plus a short
      one-line summary.
    checks:
      - kind: session.tool_called
        name: worg_mutate
      - kind: session.text_contains
        substring: PROPS_UPDATED
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Pass if the response shows or describes that ALL three
          property changes landed:
          1. ESTIMATE is now 5d (not 3d)
          2. OWNER is alice
          3. SUCCESS_CRITERIA mentions lighthouse and designer signoff

          Fail if any of the three are missing from the description
          or if the response just says "done" without naming the values.
---

# worg/mutate-properties

Properties are the "intent fields" mapping to the Pathmode/Linear
critique of issue trackers: a ticket should carry the decision context,
not just the work. This gate proves agents can both READ existing
properties and ADD new arbitrary k/v pairs (OWNER, SUCCESS_CRITERIA)
without breaking the org-mode format.
