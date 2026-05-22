#!/usr/bin/env node
// workbench — agent eval + observability + iterate-agent loop.
//
//   workbench eval [path]      run / discover eval specs
//   workbench observe <id>     aggregated session view (--format=otel for OTLP)
//   workbench improve <spec>   propose an agent diff against a failing spec
//
// Thin subcommand router. Each subcommand has its own flag-parse rules
// preserved from the legacy workbook-eval / workbook-observe /
// workbook-improve shims, so existing CI / scripts behave identically.

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cmdRoot = path.resolve(HERE, "..", "src", "commands");

const argv = process.argv.slice(2);
const sub = argv[0];
const rest = argv.slice(1);

function parseFlags(args, boolSet) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const k = a.slice(2);
        if (k.startsWith("no-")) { out[k.slice(3)] = false; continue; }
        if (boolSet.has(k)) { out[k] = true; continue; }
        const next = args[i + 1];
        out[k] = (next == null || next.startsWith("--")) ? true : (i++, next);
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function help() {
  process.stdout.write([
    "workbench — agent eval + observability + iterate-agent loop",
    "",
    "Commands:",
    "  workbench eval [path]      run eval specs (--dry, --json, --pass-k, --filter, --keep, --require-all)",
    "  workbench observe <id>     aggregate a session (--json, --format=otel)",
    "  workbench improve <spec>   propose a diff against a failing agent",
    "",
  ].join("\n"));
}

try {
  switch (sub) {
    case "eval": {
      const flags = parseFlags(rest, new Set(["json", "dry", "debug", "keep", "require-all"]));
      const { runEvalCmd } = await import(path.join(cmdRoot, "eval.mjs"));
      await runEvalCmd(flags);
      break;
    }
    case "observe": {
      const flags = parseFlags(rest, new Set(["json", "raw"]));
      const { runObserve } = await import(path.join(cmdRoot, "observe.mjs"));
      await runObserve(flags);
      break;
    }
    case "improve": {
      const flags = parseFlags(rest, new Set(["json", "auto"]));
      const { runImprove } = await import(path.join(cmdRoot, "improve.mjs"));
      await runImprove(flags);
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      help();
      break;
    default:
      process.stderr.write(`workbench: unknown command '${sub}'\n`);
      help();
      process.exit(2);
  }
} catch (err) {
  process.stderr.write(`workbench: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
}
