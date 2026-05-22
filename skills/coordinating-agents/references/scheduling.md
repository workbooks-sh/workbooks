# Scheduling recurring tasks

When the user wants work to repeat — "every Friday", "daily at 9am", "every month on the 1st" — use `schedule_task`. The contract is two calls: `preview` to parse the sentence into a structured schedule, then `create` only after the user confirms.

## Step 1 — preview

```
schedule_task({
  action: "preview",
  sentence: "every Friday at 9am LA time",
  agentSlug: "<the agent that should run it>"
})
```

Returns a `ParsedSchedule`:

```
{
  cronExpr: "0 9 * * 5",
  cronTz:   "America/Los_Angeles",
  humanReadable: "every Friday at 9:00 AM (America/Los_Angeles)",
  ambiguities: [],
  proposedTitle:       "<derived from sentence>",
  proposedDescription: "<derived from sentence>"
}
```

If `ambiguities` is non-empty, do NOT proceed. Ask a clarifying question. A schedule with open questions is a confidence regression.

## Step 2 — surface the preview for confirmation

Render the parsed schedule as a callout so the user can verify before it's committed:

```
render({
  block: {
    kind: "callout",
    tone: "info",
    title: "Schedule preview",
    text: "**When:** `every Friday at 9am` in America/Los_Angeles\n**Task:** Generate weekly metrics digest\n**Runs as:** workhorse\n\nReply 'yes' to schedule it."
  }
})
```

Fields are formatted markdown (callouts accept inline markdown). Wait for an affirmative reply.

## Step 3 — create

```
schedule_task({
  action: "create",
  agentSlug: "<same as preview>",
  cronExpr: "0 9 * * 5",
  cronTz: "America/Los_Angeles",
  taskTitle: "Generate weekly metrics digest",
  taskDescription: "<the body the agent should run>",
  authoredFromText: "every Friday at 9am LA time"
})
```

Returns `{scheduleId, nextFireAt}`. Tell the user when it will first fire AND that the first run is a dry-run — no real side effects until they approve the dry-run result in `/orchestrator` to flip the schedule live.

## Why two steps

- Cron parsing is fuzzy. The preview surfaces the parsed result so the user catches misinterpretations before they ship.
- The dry-run gate prevents a misconfigured schedule from auto-running on production data.
- `authoredFromText` preserves the user's original sentence for future audit.

## Common patterns

| Sentence | cronExpr | cronTz |
|---|---|---|
| "every Friday at 9am LA" | `0 9 * * 5` | `America/Los_Angeles` |
| "daily at 8am" | `0 8 * * *` | (user's tz from context) |
| "every month on the 1st" | `0 0 1 * *` | (user's tz) |
| "every weekday at noon ET" | `0 12 * * 1-5` | `America/New_York` |

If the user names a timezone, use it. Otherwise, the preview defaults to their session timezone — confirm in the callout that the inferred tz is right.

## Pro-active scheduling

If the user has asked you to do similar work three or more times at roughly the same cadence, offer to schedule it. One mention per session — don't pester.
