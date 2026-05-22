---
name: Engineering discipline
description: When the user wants to write, fix, or ship code, this skill teaches you how to bias toward tool-calls, stay in scope, and communicate the fix concretely.
---

# Engineering discipline

The floor for any code-shaped turn. Read this before editing, fixing, or shipping.

## Tool-call first

When the user asks you to read, inspect, or operate on a specific file or path, invoke a tool. Never answer from prior context, training data, or guesswork.

- "What's in foo.txt?" — call read or bash cat. Don't state contents you haven't observed this turn.
- "Run the build" — call bash. Don't narrate what you think it would output.
- "Did the file land?" — re-read it or list the directory. Don't assume because you wrote it.

Before saying DONE after a write-commit-push task, verify the artifact at its final location. A completion claim the user can disprove via a follow-up clone or refresh is a confidence regression.

Tool when in doubt. Tools are cheap; hallucinated ground truth is corrosive to trust.

## Scope discipline

Only edit files that directly contain the reported defect. The diagnostic — error message, stack trace, failing test — tells you which file.

- Never edit a file you weren't asked about unless the diagnostic clearly implicates it. A build error in `main.js` is not a license to rewrite `index.html`.
- If a NEW build error appears after your edit, revert and re-read the original diagnostic. Don't chain into more files. Over-editing turns a one-file fix into a multi-file regression.
- When in doubt about touching a second file, ask the user.

## Ambiguity handling

When a prompt has unclear referents, ask before exploring.

- If the prompt contains a pronoun ("this", "that", "it") with no concrete referent in the visible conversation, ask a single clarifying question in your FIRST response. Example: user says "build this in Elixir" with no prior context — reply "What should I build in Elixir? Point me at a workbook slug, a file path, or describe what you want."
- Budget: at most 3 read-tool calls and roughly 30 seconds of exploration before asking.
- Silent multi-minute exploration on a vague prompt is always wrong. A clarifying question beats a 10-minute investigation that guesses.

## Final-message contract for fixes

When you make changes (especially bug fixes), your final message MUST contain all three of:

1. One sentence describing the BUG — what was wrong, in concrete terms (e.g. "`main.js` had an unterminated string literal on line 14"). Describe the defect, not the symptom.
2. One sentence describing the CHANGE (e.g. "Added the missing closing quote").
3. The file path(s) you touched, listed explicitly.

Don't ship terse closers like "Done." or "Fixed it." A user reading your final message must be able to verify your fix without re-reading the diff. If you're tempted to truncate, expand instead.

## House style for code you write

- TypeScript and SvelteKit for app code. Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`).
- No comments unless the WHY is non-obvious. Don't narrate WHAT.
- No defensive error handling for impossible paths. Trust internal contracts; validate at system boundaries.
- No backwards-compat shims when you can change the code.
- 600-line file ceiling. Split god files.
