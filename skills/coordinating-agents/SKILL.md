---
name: Coordinating agents
description: When the work spans multiple agents or runtimes, this skill teaches you how to act as the orchestrator — decompose into subtasks, delegate to specialists, and synthesize results.
---

# Coordinating agents

You take on the orchestrator role when a request is too large for a single linear session. Triggers: bash work on `linux-sandbox` plus browser-only work on `browser-run`, multi-stage code changes that warrant review, anything where one session would lose context. For small requests, just do them yourself.

## Discovering teammates

Two coordination tools front the catalog:

- `list_agents()` — return the agents the user has access to. Use when the user asks what's available or when you need to know who could do a subtask.
- `delegate_to_agent({slug, prompt})` — hand a single self-contained task to a specialist agent and receive their result. Use when a teammate has a better-suited model, toolset, or skill graph than you do.

The "delegate vs do-yourself" heuristic: if the work would take a specialist agent less than 5 minutes, do it yourself. Orchestration overhead isn't worth it for trivial subtasks.

## Decomposing into a DAG

For genuinely multi-stage work, decompose into a DAG of subtasks via the orchestrator board (Studio surfaces this at `/orchestrator`). Three tools:

- `graft_task({parentTaskId, childTaskId, title, ...})` — create a child task under a parent. Subtasks become DAG nodes on the board.
- `wait_for_task({taskId, timeoutSecs?})` — block until a task reaches a terminal state (done, blocked, cancelled). Returns `{state, resultSummary}`.
- `summarize_branch({rootTaskId})` — walk a root task's descendants and return every node's state plus `resultSummary`. Use this to synthesize a final report.

The board is the IPC. Subagents return condensed summaries via the task's `resultSummary`, never raw transcripts. You DO NOT do bottom-level coding work yourself when a specialist agent is available — your job is decomposition, delegation, and synthesis.

## Working in a workgroup

Every workbook in a workgroup you have access to contributes its declared tools to your toolset, namespaced as `wb__<workbook-slug>__<tool-name>`. The runtime auto-binds them at session boot via the broker's aggregated MCP endpoint, so a workgroup full of workbooks effectively gives you a pre-wired toolset for that group's domain. List them like any other tool.

## Creating durable resources

When the user describes a role or shared space they want to keep around (not a one-off), register it instead of operating ephemerally. See `references/creating-agents.md` for the `create_agent` and `create_group` argument shapes.

## Scheduling recurring work

When the user says "every Friday", "daily", "every month on the 1st", or otherwise describes recurring work, use `schedule_task`. The two-step contract — preview, then create after confirmation — is non-negotiable. See `references/scheduling.md` for the full procedure and the confirmation-callout template.

Pro-active suggestion: if the user has asked you to do similar work three or more times in roughly the same cadence, offer to schedule it. One mention per session is plenty — don't pester.

## References

- `references/scheduling.md` — `schedule_task` preview-then-create contract, the confirmation callout, dry-run policy.
- `references/creating-agents.md` — `create_agent` and `create_group` arguments and when to call each.
