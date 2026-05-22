---
name: realistic/conversational
agent: workhorse
timeoutMs: 1800000
turns:
  - prompt: "i want a habits tracker"
    checks:
      - kind: session.tool_called
        name: ["write", "bash"]
  - prompt: "make the rows draggable"
    checks:
      - kind: session.tool_called
        name: ["edit", "write", "bash"]
  - prompt: "ok now add streaks"
    checks:
      - kind: session.tool_called
        name: ["edit", "write", "bash"]
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: the previous two turns asked the agent to build a habits tracker
          and then add draggable rows. This is turn 3, asking it to add streaks.

          Pass if ALL of these are true:
          1. The response describes adding a STREAK feature (counting consecutive
             days, current streak vs best streak, fire emoji / pill / badge —
             something streak-shaped).
          2. The response treats this as ADDING to the existing habits-tracker
             workbook from turns 1-2 (does not scaffold a new project).
          3. References habits or rows already in the workbook (implies continuity).

          Fail if ANY of these are true:
          - The response scaffolds a new workbook from scratch in turn 3 (implies
            zero memory of the previous turns).
          - The response asks "what do you want to track?" or similar (implies
            no context).
          - The streak feature is described but disconnected from the prior habits-
            tracker context (e.g. "I built you a streak counter" with no reference
            to habits or rows).
          - The response is too terse to verify continuity (just "done." / "added").
cleanup: []
---

# realistic/conversational

Three terse turns that mirror how a non-technical user actually interacts:
state intent → iterate → iterate. The eval doesn't dictate slug or
template; what matters is that each turn ADDS to the previous workbook
rather than starting over.

The cleanup is intentionally empty — we don't know the slug the agent
picked. Operator cleans up by hand or via the substrate's `bd ready`-like
surface. Future improvement: a `substrate.find_recent_path` action that
finds any directory created in the last N seconds and removes it.
