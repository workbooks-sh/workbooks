import type { AgentLoopOptions, AgentLoopResult, AgentTool } from "./agentLoop";
import { runAgentLoop } from "./agentLoop";
import type { LlmClient } from "./llmClient";

export type AgentRuntimeTarget =
  | "browser-js"
  | "worker-js"
  | "workflow-js"
  | "browser-run"
  // browser-opfs — same as browser-run but the agent's working FS
  // is OPFS-backed via a Web Worker; writes survive reloads. wb-kbf.
  | "browser-opfs"
  | "linux-sandbox";

export type AgentRunEventKind =
  | "session_start"
  | "message_delta"
  | "tool_start"
  | "tool_end"
  | "agent_end"
  | "done"
  | "error";

export interface AgentRunEvent {
  kind: AgentRunEventKind;
  ts: number;
  payload: Record<string, unknown>;
}

export interface AgentRuntimeDescriptor {
  target: AgentRuntimeTarget;
  adapter: string;
  reason: string;
}

export interface RunPortableAgentOptions {
  llmClient: LlmClient;
  model: string;
  systemPrompt: string;
  initialUserMessage: string;
  tools?: AgentTool[];
  runtime: AgentRuntimeDescriptor;
  maxIterations?: number;
  emit?: (event: AgentRunEvent) => void;
  onDelta?: (text: string) => void;
}

function now(): number {
  return Date.now();
}

export function agentRunEvent(
  kind: AgentRunEventKind,
  payload: Record<string, unknown> = {},
): AgentRunEvent {
  return { kind, ts: now(), payload };
}

export async function runPortableAgent(
  opts: RunPortableAgentOptions,
): Promise<AgentLoopResult> {
  const emit = opts.emit;
  emit?.(
    agentRunEvent("session_start", {
      model: opts.model,
      runtimeTarget: opts.runtime.target,
      runtimeAdapter: opts.runtime.adapter,
      runtimeReason: opts.runtime.reason,
    }),
  );

  try {
    const loopOpts: AgentLoopOptions = {
      llmClient: opts.llmClient,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      initialUserMessage: opts.initialUserMessage,
      tools: opts.tools,
      maxIterations: opts.maxIterations,
      onDelta: (text) => {
        opts.onDelta?.(text);
        emit?.(agentRunEvent("message_delta", { text }));
      },
      onToolStart: (call) => {
        emit?.(
          agentRunEvent("tool_start", {
            toolCallId: call.id,
            toolName: call.name,
            args: call.argumentsJson ? safeJson(call.argumentsJson) : null,
          }),
        );
      },
      onToolCall: (call, result) => {
        emit?.(
          agentRunEvent("tool_end", {
            toolCallId: call.id,
            toolName: call.name,
            isError: result.startsWith("error:"),
            output: result,
          }),
        );
      },
    };
    const result = await runAgentLoop(loopOpts);
    emit?.(
      agentRunEvent("agent_end", {
        usage: result.usage ?? null,
        stopReason: result.stopReason,
        iterations: result.iterations,
      }),
    );
    emit?.(agentRunEvent("done", { ok: true }));
    return result;
  } catch (err) {
    emit?.(
      agentRunEvent("error", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    throw err;
  }
}

function safeJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
