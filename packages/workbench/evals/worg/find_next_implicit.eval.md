---
name: worg/find-next-implicit
agent: workhorse
runtime: beam
timeoutMs: 180000
turns:
  - prompt: |
      I keep my plan in /plan.org. What should I work on next?
    checks:
      - kind: session.tool_called
        name: [worg_query, worg_parse, read]
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Setup context: the agent has access to worg_query / worg_parse
          / read tools and skill-bundle docs at /skills/. The user
          asked an implicit conversational question with no tool name.

          IMPORTANT: in this scenario, /plan.org does NOT exist yet.
          The user said "I keep my plan in /plan.org" but the file
          isn't there. The correct behavior depends on this state:

          - If the agent inspects /plan.org and finds it MISSING, the
            right move is to (a) state the file isn't there and
            (b) offer to scaffold one. Since the user gave no content
            about what they're working on, the agent MUST ask for that
            content — there's no way to scaffold a meaningful plan
            without it. That's correct behavior, not hedging.

          - If /plan.org existed with NEXT/TODO headlines, the agent
            would be expected to surface the next item by name and
            NOT ask the user to retype their plan. That's the
            REFLEXIVE check this spec is shaped around. But it
            depends on the file actually existing.

          Pass if ALL of these are true:
          1. The agent inspected /plan.org (any tool that reads it
             counts — worg_query, worg_parse, or read).
          2. The agent acknowledged the file is missing — did NOT
             pretend it found tasks that don't exist, did NOT
             hallucinate a NEXT/TODO item.
          3. The agent offered to scaffold a plan (or proposed creating
             one), framing the question constructively rather than
             dumping "no plan, you tell me what to do" on the user.

          Fail if:
          - The agent INVENTED a NEXT/TODO item out of nothing. With a
            missing file, this is hallucination.
          - The agent passively reported "/plan.org doesn't exist"
            and stopped, without offering to scaffold or otherwise
            move forward.
          - The agent failed to read the file at all and just asked
            the user what their plan is — the read is load-bearing
            even when the file is absent.
---

# worg/find-next-implicit (Layer 2, prompt-shape variant)

The agent is asked an implicit, conversational question with no
explicit tool reference. Tests whether worg is REFLEXIVE — does the
agent reach for /plan.org and the worg tools on its own when the
shape of the question suggests planning context exists?

Companion to worg/query-by-state (Layer 1, explicit): same goal,
softer prompt.
