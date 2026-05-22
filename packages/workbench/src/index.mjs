// @work.books/workbench — programmatic API.
//
// The eval framework, observability aggregator, and improver loop are
// also exposed as binaries (`workbench eval`, `workbench observe`,
// `workbench improve`) and routed through the main `workbook`
// dispatcher. Consumers that want to embed the framework can import
// these entries directly.

export { runEvalCmd } from "./commands/eval.mjs";
export { runObserve } from "./commands/observe.mjs";
export { runImprove } from "./commands/improve.mjs";

export { runEval } from "./eval/runner.mjs";
export { loadSpec, discoverSpecs } from "./eval/spec.mjs";
export { improveFailingSpecs } from "./eval/improve.mjs";

export { aggregate } from "./observe/aggregate.mjs";
export { bundleToOTLP } from "./observe/otel.mjs";

export { resolveWorkbookBin } from "./util/workbook-bin.mjs";
