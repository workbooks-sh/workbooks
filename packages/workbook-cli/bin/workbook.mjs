#!/usr/bin/env node
// Workbook CLI — dev / build / init.
//
// Thin dispatcher; the real work is in src/commands/*.

import { fileURLToPath } from "node:url";
import path from "node:path";

const argv = process.argv.slice(2);
const cmd = argv[0];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cmdRoot = path.resolve(HERE, "..", "src", "commands");

async function help() {
  process.stdout.write([
    "workbook — build tool for portable .html artifacts",
    "",
    "Commands:",
    "  workbook dev [project]     start a Vite dev server with HMR",
    "  workbook build [project]   compile project into dist/<slug>.html",
    "  workbook check [project]   lint a workbook source tree (--reporter=json for tools)",
    "  workbook check <built.html>  lint a built presentation artifact (--json, --rules, --no-fail)",
    "  workbook export pdf <html> --out <file.pdf>",
    "                            render a presentation workbook to static PDF",
    "  workbook explain <rule>    show rationale + fix for a check rule",
    "  workbook encrypt           emit an encrypted <wb-data> element from a file",
    "  workbook seal              wrap a workbook in a Workbooks Studio envelope",
    "  workbook unseal            (testing) decrypt a sealed workbook with a known DEK",
    "  workbook inspect <path>    show metadata of a sealed workbook (no decryption)",
    "  workbook inspect-tools <html>",
    "                            print the wb-capabilities tool manifest from a built .html",
    "  workbook keygen            generate an Ed25519 author keypair for signing",
    "  workbook init <name>       scaffold a new workbook project (--template=spa|presentation)",
    "  workbook unbundle <html>   extract embedded source bundle from a built .html",
    "  workbook status [project]  diff local source tree against dist/<slug>.html (--json for CI)",
    "  workbook publish <html>    upload a built .html and get a workbooks.sh/w/<id> URL",
    "  workbook auth chatgpt      sign in with your ChatGPT subscription via loopback OAuth;",
    "                              prints a paste-able token bundle for Studio integrations",
    "  workbook pull --id <id>    fetch a published workbook's source bundle, diff vs local,",
    "                              prompt-confirm, apply (--force skips prompt; --delete-extra",
    "                              removes locally-only files)",
    "  workbook push --id <id>    build locally + diff vs remote + prompt-confirm + upload",
    "                              (--force skips prompt)",
    "  workbook env <action>      manage group env vars (list/set/rotate/delete/import)",
    "  workbook db <action>       provision / link / list databases (create | link | list)",
    "  workbook group <action>    list / invite / archive / restore / rm / purge",
    "  workbook mcp serve         expose CLI actions as MCP tools for Claude / Cursor / Codex",
    "  workbook call <id> <tool>  invoke a tool exposed by a workbook (--list to introspect)",
    "  workbook workgroup <action> manage a group's portal config end-to-end (pull/push)",
    "  workbook agent <action>    pull a published agent artifact (publish via `workbook publish`)",
    "  workbook plan <sub> <file> ...",
    "                             mutate .org plan files (ready/claim/transition/log/result/close)",
    "  workbook session <id>      export a chat session as JSON or markdown (--format=md|json)",
    "  workbook chat <agent> \"<p>\" send a prompt to one of your agents and stream the reply (--session, --json, --debug, --no-open)",
    "  workbook git <action>      substrate git ops — url / setup / clone / credential-helper",
    "  workbook connections list  list integration connections you can use (--toolkit, --json)",
    "  capabilities                 list/explain/resolve Studio capabilities",
    "  workbook eval [path]       run agent eval specs (--dry, --json, --pass-k, --filter, --keep, --require-all)",
    "  workbook observe <id>      aggregated session view (--json, --format=otel)",
    "  workbook improve <spec>    propose an agent diff against a failing spec",
    "",
    "Build / dev options:",
    "  --port <n>      dev server port (default 5173)",
    "  --out <dir>     build output dir (default dist)",
    "  --runtime <p>   override path to workbook-runtime checkout (auto-detected)",
    "  --no-wasm       skip inlining wasm + runtime bundle (smaller, dev-only)",
    "  --no-bundle     skip embedding the gzipped source bundle (default ON for",
    "                  unencrypted builds; recipients can `workbook unbundle`",
    "                  the .html to recover the source)",
    "  --bundle-git    include the .git/ directory in the source bundle (off",
    "                  by default — git histories can balloon the artifact)",
    "  --encrypt       wrap the artifact in a passphrase lock screen (age-v1).",
    "                  Pair with --password-stdin / --password-file or set",
    "                  the env var declared by encrypt.passwordEnv in",
    "                  workbook.config.mjs (default WORKBOOK_PASSWORD).",
    "                  Dev mode uses encrypt.devPassword if set.",
    "  --bake-public-db",
    "                  bake database credentials from workbook.local.json into",
    "                  the artifact. Refuses Supabase service-role keys. Use",
    "                  for public-RLS demos where the anon key is meant to be",
    "                  visible.",
    "  --embed-private bake database credentials into the artifact without the",
    "                  anon-shape check. Use for self-use builds; the artifact",
    "                  contains live secrets — do not redistribute.",
    "  --template      produce a redistributable artifact: refuses --bake-public-db",
    "                  / --embed-private / --encrypt, strips author from the",
    "                  manifest, asserts no baked-creds tag in the output.",
    "",
    "Dev (`workbook dev`):",
    "  Local credentials from workbook.local.json are loaded automatically.",
    "  Gitignore that file — it must never be committed.",
    "",
    "Encrypt options (`workbook encrypt`):",
    "  --in <path>           input file to encrypt",
    "  --out <path>          where to write the <wb-data> element",
    "  --id <data-id>        data block id (the cells' reads= target)",
    "  --mime <mime>         payload mime (text/csv, application/x-sqlite3, …)",
    "  --password <s>        passphrase (visible in `ps`; prefer --password-stdin)",
    "  --password-stdin      read passphrase from stdin (first line)",
    "  --password-file <p>   read passphrase from first line of a file",
    "  --recipient <age1…>   X25519 recipient (repeatable). Combine with",
    "                        --password to allow either unlock path. (Phase D)",
    "  --recipient-file <p>  first line of <p> as a recipient (repeatable)",
    "  --sign-key <b64>      Ed25519 priv key (base64) for signing — pairs with",
    "                        the runtime's expectedAuthorPubkey for tamper-evidence",
    "  --sign-key-file <p>   read sign key from first line of a file",
    "",
    "Keygen options (`workbook keygen`):",
    "  --type <kind>         'signing' (default, Ed25519) or 'x25519' (age recipient)",
    "  --out <basename>      writes <basename>.priv (0600) + <basename>.pub (0644)",
    "",
    "Run dev/build inside a project containing workbook.config.js (or pass [project]).",
    "",
  ].join("\n"));
}

// Flags that may appear multiple times (`--recipient age1... --recipient age1...`).
// On repeat, values accumulate into an array instead of clobbering.
const MULTI_VALUE_FLAGS = new Set(["recipient", "recipient-file", "tag", "arg"]);

// Flags that NEVER take a value — always boolean. Without this, the
// next positional arg is mistakenly consumed as the flag's value
// (e.g. `--encrypt examples/stocks` sets encrypt='examples/stocks').
const BOOLEAN_FLAGS = new Set([
  "encrypt",
  "password-stdin",
  "force",
  "embed-private",
  "bake-public-db",
  "template",
  "delete-extra",
  "register",
  "json",
  "debug",
  // Workbench (eval/observe/improve) booleans — wb-zy76.
  "dry",
  "keep",
  "require-all",
  "raw",
  "auto",
]);

function parseFlags(rest) {
  const out = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      // Support both `--key value` and `--key=value`.
      const eq = a.indexOf("=");
      let k;
      let value;
      if (eq !== -1) {
        k = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        k = a.slice(2);
        if (k.startsWith("no-")) { out[k.slice(3)] = false; continue; }
        if (BOOLEAN_FLAGS.has(k)) { value = true; }
        else {
          const next = rest[i + 1];
          value = (next == null || next.startsWith("--")) ? true : (i++, next);
        }
      }
      if (MULTI_VALUE_FLAGS.has(k)) {
        if (out[k] === undefined) out[k] = [];
        else if (!Array.isArray(out[k])) out[k] = [out[k]];
        out[k].push(value);
      } else {
        out[k] = value;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

try {
  switch (cmd) {
    case "dev": {
      const flags = parseFlags(argv.slice(1));
      const { runDev } = await import(path.join(cmdRoot, "dev.mjs"));
      await runDev({ project: flags._[0] ?? ".", ...flags });
      break;
    }
    case "build": {
      const flags = parseFlags(argv.slice(1));
      const { runBuild } = await import(path.join(cmdRoot, "build.mjs"));
      await runBuild({ project: flags._[0] ?? ".", ...flags });
      break;
    }
    case "db": {
      const flags = parseFlags(argv.slice(1));
      const { runDb } = await import(path.join(cmdRoot, "db.mjs"));
      await runDb(flags);
      break;
    }
    case "encrypt": {
      const flags = parseFlags(argv.slice(1));
      const { runEncrypt } = await import(path.join(cmdRoot, "encrypt.mjs"));
      await runEncrypt(flags);
      break;
    }
    case "seal": {
      const flags = parseFlags(argv.slice(1));
      const { runSeal } = await import(path.join(cmdRoot, "seal.mjs"));
      await runSeal(flags);
      break;
    }
    case "unseal": {
      const flags = parseFlags(argv.slice(1));
      const { runUnseal } = await import(path.join(cmdRoot, "unseal.mjs"));
      await runUnseal(flags);
      break;
    }
    case "inspect": {
      const flags = parseFlags(argv.slice(1));
      const { runInspect } = await import(path.join(cmdRoot, "inspect.mjs"));
      await runInspect(flags);
      break;
    }
    case "inspect-tools": {
      const flags = parseFlags(argv.slice(1));
      const { runInspectTools } = await import(path.join(cmdRoot, "inspectTools.mjs"));
      await runInspectTools(flags);
      break;
    }
    case "keygen": {
      const flags = parseFlags(argv.slice(1));
      const { runKeygen } = await import(path.join(cmdRoot, "keygen.mjs"));
      await runKeygen(flags);
      break;
    }
    case "check": {
      const flags = parseFlags(argv.slice(1));
      const { runCheck } = await import(path.join(cmdRoot, "check.mjs"));
      await runCheck({ project: flags._[0] ?? ".", ...flags });
      break;
    }
    case "export": {
      const flags = parseFlags(argv.slice(1));
      const { runExport } = await import(path.join(cmdRoot, "export.mjs"));
      await runExport(flags);
      break;
    }
    case "explain": {
      const flags = parseFlags(argv.slice(1));
      const { runExplain } = await import(path.join(cmdRoot, "explain.mjs"));
      await runExplain(flags);
      break;
    }
    case "init": {
      const flags = parseFlags(argv.slice(1));
      const { runInit } = await import(path.join(cmdRoot, "init.mjs"));
      await runInit(flags);
      break;
    }
    case "auth": {
      // `workbook auth <provider>` — currently chatgpt only. Each
      // sub-provider runs its own loopback OAuth dance and prints a
      // paste-able token bundle for Studio. wb-3l4.
      const sub = argv[1];
      const flags = parseFlags(argv.slice(2));
      if (sub === "chatgpt") {
        const { runAuthChatgpt } = await import(path.join(cmdRoot, "authChatgpt.mjs"));
        await runAuthChatgpt(flags);
      } else {
        console.error(
          `workbook auth: unknown provider ${JSON.stringify(sub ?? "")}. Supported: chatgpt`,
        );
        process.exit(2);
      }
      break;
    }
    case "unbundle": {
      const flags = parseFlags(argv.slice(1));
      const { runUnbundle } = await import(path.join(cmdRoot, "unbundle.mjs"));
      await runUnbundle(flags);
      break;
    }
    case "status": {
      const flags = parseFlags(argv.slice(1));
      const { runStatus } = await import(path.join(cmdRoot, "status.mjs"));
      await runStatus({ project: flags._[0] ?? ".", ...flags });
      break;
    }
    case "publish": {
      const flags = parseFlags(argv.slice(1));
      const { runPublish } = await import(path.join(cmdRoot, "publish.mjs"));
      await runPublish(flags);
      break;
    }
    case "pull": {
      const flags = parseFlags(argv.slice(1));
      const { runPull } = await import(path.join(cmdRoot, "sync.mjs"));
      await runPull({ project: flags._[0] ?? ".", ...flags });
      break;
    }
    case "push": {
      const flags = parseFlags(argv.slice(1));
      const { runPush } = await import(path.join(cmdRoot, "sync.mjs"));
      await runPush({ project: flags._[0] ?? ".", ...flags });
      break;
    }
    case "env": {
      const flags = parseFlags(argv.slice(1));
      const { runEnv } = await import(path.join(cmdRoot, "env.mjs"));
      await runEnv(flags);
      break;
    }
    case "group": {
      const flags = parseFlags(argv.slice(1));
      const { runGroup } = await import(path.join(cmdRoot, "group.mjs"));
      await runGroup(flags);
      break;
    }
    case "mcp": {
      const flags = parseFlags(argv.slice(1));
      const { runMcp } = await import(path.join(cmdRoot, "mcp.mjs"));
      await runMcp(flags);
      break;
    }
    case "call": {
      const flags = parseFlags(argv.slice(1));
      const { runCall } = await import(path.join(cmdRoot, "call.mjs"));
      await runCall(flags);
      break;
    }
    case "workgroup": {
      const flags = parseFlags(argv.slice(1));
      const { runWorkgroup } = await import(path.join(cmdRoot, "workgroup.mjs"));
      await runWorkgroup(flags);
      break;
    }
    case "agent": {
      const flags = parseFlags(argv.slice(1));
      const { runAgent } = await import(path.join(cmdRoot, "agent.mjs"));
      await runAgent(flags);
      break;
    }
    case "session": {
      const flags = parseFlags(argv.slice(1));
      const { runSession } = await import(path.join(cmdRoot, "session.mjs"));
      await runSession(flags);
      break;
    }
    case "git": {
      const flags = parseFlags(argv.slice(1));
      const { runGit } = await import(path.join(cmdRoot, "git.mjs"));
      await runGit(flags);
      break;
    }
    case "chat": {
      const flags = parseFlags(argv.slice(1));
      const { runChat } = await import(path.join(cmdRoot, "chat.mjs"));
      await runChat(flags);
      break;
    }
    case "connections": {
      const flags = parseFlags(argv.slice(1));
      const { runConnections } = await import(
        path.join(cmdRoot, "connections.mjs")
      );
      await runConnections(flags);
      break;
    }
    case "capabilities": {
      const flags = parseFlags(argv.slice(1));
      const { runCapabilities } = await import(
        path.join(cmdRoot, "capabilities.mjs")
      );
      await runCapabilities(flags);
      break;
    }
    // Workbench surfaces — eval / observe / improve live in
    // @work.books/workbench. Routed here so `workbook eval ...` keeps
    // working alongside the dedicated `workbench` binary. wb-zy76.
    case "eval": {
      const flags = parseFlags(argv.slice(1));
      const { runEvalCmd } = await import("@work.books/workbench/eval");
      await runEvalCmd(flags);
      break;
    }
    case "observe": {
      const flags = parseFlags(argv.slice(1));
      const { runObserve } = await import("@work.books/workbench/observe");
      await runObserve(flags);
      break;
    }
    case "improve": {
      const flags = parseFlags(argv.slice(1));
      const { runImprove } = await import("@work.books/workbench/improve");
      await runImprove(flags);
      break;
    }
    case "plan": {
      const flags = parseFlags(argv.slice(1));
      const { runPlan } = await import(path.join(cmdRoot, "plan.mjs"));
      await runPlan(flags);
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      await help();
      break;
    default:
      console.error(`workbook: unknown command '${cmd}'`);
      await help();
      process.exit(2);
  }
} catch (err) {
  process.stderr.write(`workbook: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
}
