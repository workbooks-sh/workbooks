// Resolve the BEAM agent runner spawn args. Used by the eval runner
// when spec.runtime === "beam" — instead of spawning `workbook chat`
// (which routes through Convex), we spawn the Elixir-side
// `mix wb.agent.chat` task in apps/studio/workhorse/ directly.
//
// Protocol parity: the BEAM task emits the same NDJSON shape the
// existing workbook-chat path emits (chat.open, message_delta,
// tool_start, tool_result, chat.close). See
// apps/studio/workhorse/lib/workhorse/agent/event_sink/workbench.ex.
//
// Workbench's WORKBOOKS_RUNTIME_DIR env var lets ops override the path
// to the Elixir runtime app; default is `apps/studio/workhorse`
// relative to the workbench process CWD.

export function resolveBeamRunner(workbookArgs) {
  const [first, ...rest] = workbookArgs;
  if (first !== "chat") {
    throw new Error(`beam runtime only supports 'chat' commands; got: ${first}`);
  }

  const runtimeDir = process.env.WORKBOOKS_RUNTIME_DIR ?? "apps/studio/workhorse";

  // Mix has no CWD-override flag — we set the spawn CWD instead.
  // Caller passes the third element as the `cwd` option to spawn().
  // Stdio is captured by the caller; protocol is identical to
  // `workbook chat`.
  return ["mix", ["wb.agent.chat", ...rest], { cwd: runtimeDir }];
}
