/**
 * Declarative agent surface — `<wb-agent>` element + `<wb-cell language="agent">`
 * cell language registration. This file is the layer between the
 * authoring vocabulary the four shape SKILL.md files document and the
 * imperative runAgentLoop / runPortableAgent runtime in agentRuntime.ts.
 *
 * Two integration points:
 *   1. `installAgentCellLanguage(registry, opts)` — registers a
 *      CustomCellExecutor for language="agent". The cell's source is
 *      the user prompt; the executor returns the agent's final text as
 *      a single text CellOutput. Lets notebook authors drop in
 *      `<wb-cell id="ask" language="agent" model="..." system="...">
 *      prompt here</wb-cell>` and get an agent turn run inside the DAG.
 *   2. `installAgentElement()` — defines the bare `<wb-agent>` and
 *      `<wb-tool>` custom elements so the browser doesn't treat
 *      unrecognized elements as `HTMLUnknownElement`. Layout-only;
 *      the real wiring still happens inside mountHtmlWorkbook via
 *      bindAgentElement. Calling this before mount makes shape skill
 *      examples work in environments where custom elements are
 *      enforced (e.g. some CSP-strict viewers).
 *
 * The agent cell executor needs an llmClient. Callers either pass one
 * via opts.llmClient or pass a factory that returns one from the
 * mount-time WorkbookContext (ctx.llmClient).
 */

import type { AgentTool } from "./agentLoop";
import { runPortableAgent } from "./agentRuntime";
import type { CellOutput } from "./wasmBridge";
import type { LlmClient } from "./llmClient";
import type {
  CustomCellExecutor,
  WorkbookCellRegistry,
  WorkbookContext,
} from "./htmlBindings";
import { registerWorkbookCell } from "./htmlBindings";

export interface AgentCellOptions {
  /**
   * Override llmClient resolution. Default: read from ctx.llmClient at
   * execute time. Pass a function to inject a stub (smoke tests) or a
   * differently-configured client per cell.
   */
  resolveLlmClient?: (ctx: WorkbookContext) => LlmClient | undefined;
  /**
   * Tools exposed to agent-language cells. Same shape as the tools
   * the host wires for <wb-agent>. Default empty — agent cells run
   * chat-only.
   */
  tools?: AgentTool[];
  /**
   * Max model turns per cell run. Default 4 — agent cells are typically
   * one-shot queries; multi-turn reasoning belongs in <wb-chat>.
   */
  maxIterations?: number;
  /** Fallback model if the cell doesn't carry a `model=` attribute. */
  defaultModel?: string;
}

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

export function createAgentCellExecutor(
  opts: AgentCellOptions = {},
): CustomCellExecutor {
  const resolveClient =
    opts.resolveLlmClient ?? ((ctx: WorkbookContext) => ctx.llmClient);
  const tools = opts.tools ?? [];
  const maxIterations = opts.maxIterations ?? 4;
  const defaultModel = opts.defaultModel ?? DEFAULT_MODEL;

  return {
    async execute({ source, params, cellId, ctx }) {
      const llmClient = resolveClient(ctx);
      if (!llmClient) {
        return [errorOutput(`agent cell '${cellId}': no llmClient configured`)];
      }
      const { model, systemPrompt } = readCellMetadata(cellId, defaultModel);
      const prompt = source.trim();
      if (!prompt) {
        return [errorOutput(`agent cell '${cellId}': empty prompt`)];
      }
      const contextLines = paramsToContextLines(params);
      const userMessage = contextLines
        ? `Context:\n\n${contextLines}\n\n${prompt}`
        : prompt;
      try {
        const result = await runPortableAgent({
          llmClient,
          model,
          systemPrompt,
          initialUserMessage: userMessage,
          tools,
          maxIterations,
          runtime: {
            target: "browser-js",
            adapter: "workbook-html",
            reason:
              "agent cell language — agent turn runs inside the workbook DAG.",
          },
        });
        return [{ kind: "text", content: result.text ?? "" }];
      } catch (err) {
        return [
          errorOutput(
            err instanceof Error ? err.message : String(err),
          ),
        ];
      }
    },
  };
}

/**
 * Register the agent cell language on a per-mount registry (preferred)
 * or the module-global registry (fallback). Returns the executor for
 * inspection / test stubbing.
 */
export function installAgentCellLanguage(
  registry: WorkbookCellRegistry | null,
  opts: AgentCellOptions = {},
): CustomCellExecutor {
  const executor = createAgentCellExecutor(opts);
  if (registry) {
    registry.register("agent", executor);
  } else {
    registerWorkbookCell("agent", executor);
  }
  return executor;
}

/**
 * Define `<wb-agent>` and `<wb-tool>` as inert custom elements. The
 * runtime's bindAgentElement does the actual wiring at mount time;
 * defining the elements here just ensures they're not
 * `HTMLUnknownElement` in environments that distinguish them
 * (Shadow DOM hosts, some CSP-strict viewers, custom-element
 * polyfills). Idempotent — re-registration is silently ignored.
 */
export function installAgentElement(): void {
  if (typeof globalThis === "undefined") return;
  const win = globalThis as unknown as {
    customElements?: CustomElementRegistry;
    HTMLElement?: typeof HTMLElement;
  };
  if (!win.customElements || !win.HTMLElement) return;
  defineOnce(win.customElements, "wb-agent", win.HTMLElement);
  defineOnce(win.customElements, "wb-tool", win.HTMLElement);
}

function defineOnce(
  registry: CustomElementRegistry,
  name: string,
  Base: typeof HTMLElement,
): void {
  if (registry.get(name)) return;
  // Subclass so each tag gets its own constructor (custom-element spec
  // forbids reusing HTMLElement directly).
  class WbInertElement extends Base {}
  registry.define(name, WbInertElement);
}

function readCellMetadata(
  cellId: string,
  defaultModel: string,
): { model: string; systemPrompt: string } {
  // Cell metadata travels in the source DOM — the cell language
  // executor only receives source + params, so we sniff the host
  // <wb-cell> by id for the agent-specific attributes.
  if (typeof document === "undefined") {
    return { model: defaultModel, systemPrompt: "" };
  }
  const el = document.querySelector(
    `wb-cell[id="${CSS.escape(cellId)}"]`,
  ) as HTMLElement | null;
  if (!el) return { model: defaultModel, systemPrompt: "" };
  const model = el.getAttribute("model") ?? defaultModel;
  const systemPrompt = el.getAttribute("system") ?? "";
  return { model, systemPrompt };
}

function paramsToContextLines(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return entries
    .map(([k, v]) => `### ${k}\n${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n\n");
}

function errorOutput(message: string): CellOutput {
  return { kind: "error", message };
}
