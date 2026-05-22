// `workbook init <name>` — scaffold a new workbook project.
//
// Stamps a chosen template  into ./<name>/, rewrites
// placeholder tokens for slug/name/cli-version, and prints next steps.
//
// Templates live at ../../templates/<shape>/. Each template is a real
// directory tree containing files that may include the placeholders:
//
//   %%NAME%%          human-readable display name (defaults to slug)
//   %%SLUG%%          kebab-case identifier (defaults to dir name)
//   %%CLI_VERSION%%   pinned semver of @work.books/cli
//   %%WRAPPED_SLUG%%  (playground only) slug of the sibling demo workbook
//                     scaffolded alongside the playground.
//
// The playground template is special: it produces TWO sibling
// directories — the playground itself and a minimal wrapped demo
// workbook — so the author has a runnable starting point and can
// see the slider-tunes-canvas loop on first build.
//
// The eighth-grader test:
//   $ npm install -g @work.books/cli
//   $ workbook init my-thing
//   $ cd my-thing && npm install && npm run dev
// Working in three commands.

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = path.resolve(HERE, "..", "..", "templates");
const CLI_VERSION = await readCliVersion();

// Canonical shapes. The `playground` directory under templates/ is a
// starter for an spa-with-stage; it's not a shape itself, so authors
// scaffold via `--template playground` (template selector) rather than
// `--shape playground`. Keep this aligned with WORKBOOK_SHAPES exported
// from @work.books/runtime — drift surfaces via `bun run check:shape-drift`.
const SHAPES = ["document", "notebook", "spa", "presentation", "agent"];

// Non-shape templates — spa-pattern starters that scaffold a particular
// runtime wrapping (stage, theater) on top of an spa workbook. Stay in
// sync with the templates/ directory.
const EXTRA_TEMPLATES = ["playground", "video"];

/**
 * @param {{
 *   _: string[],
 *   template?: string,    // shape name (spa | presentation | playground | notebook | document)
 *   force?: boolean,      // overwrite a non-empty target directory
 * }} flags
 */
export async function runInit(flags = {}) {
  const name = flags._?.[0];
  if (!name) {
    process.stderr.write("workbook init: project name required.\n");
    process.stderr.write("usage: workbook init <name> --template=spa|document|notebook|presentation|agent|playground\n");
    process.exit(2);
  }

  const slug = toSlug(name);
  if (!slug) {
    process.stderr.write(`workbook init: '${name}' isn't a valid project name (need at least one letter or digit)\n`);
    process.exit(2);
  }

  const ALL_TEMPLATES = [...SHAPES, ...EXTRA_TEMPLATES];
  if (!flags.template) {
    process.stderr.write(
      "workbook init: --template is required. Pick one of:\n" +
        ALL_TEMPLATES.map((s) => `  --template=${s}`).join("\n") + "\n",
    );
    process.exit(2);
  }
  const shape = flags.template;
  if (!ALL_TEMPLATES.includes(shape)) {
    process.stderr.write(
      `workbook init: unknown template '${shape}'. ` +
      `available: ${ALL_TEMPLATES.join(", ")}\n`,
    );
    process.exit(2);
  }
  // Sandbox / scoped-author gate. When WORKBOOKS_ALLOWED_TEMPLATES is
  // set (comma-separated), reject anything outside that list. Lets the
  // runner enforce skill-derived restrictions structurally — an agent
  // with only the workbook-document skill enabled gets a hard CLI
  // error if it tries --template=spa, not a build-time guess. Absent
  // env var = no restriction (humans / authors at terminals).
  const allowedEnv = process.env.WORKBOOKS_ALLOWED_TEMPLATES;
  if (typeof allowedEnv === "string" && allowedEnv.length > 0) {
    const allowed = allowedEnv.split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(shape)) {
      process.stderr.write(
        `workbook init: template '${shape}' is not enabled for this session. ` +
        `Allowed: ${allowed.join(", ") || "(none — enable a workbook-* skill on this agent)"}\n`,
      );
      process.exit(2);
    }
  }
  const templateDir = path.join(TEMPLATES_ROOT, shape);
  try {
    await fs.access(templateDir);
  } catch {
    process.stderr.write(
      `workbook init: template '${shape}' is missing on disk at ${templateDir} — packaging bug, please file an issue.\n`,
    );
    process.exit(2);
  }

  // Playground is the only template that scaffolds two siblings.
  // Single-target templates (spa, presentation) fall through to the
  // simple path below.
  if (shape === "playground") {
    await scaffoldPlaygroundPair({ name, slug, templateDir, force: !!flags.force });
    return;
  }

  const target = path.resolve(name);
  await assertWritable(target, !!flags.force);

  const replacements = baseReplacements(name, slug);
  const filesWritten = await stamp(templateDir, target, replacements);

  process.stdout.write(`✓ created ${path.relative(process.cwd(), target) || target}/\n`);
  for (const f of filesWritten.sort()) {
    process.stdout.write(`    ${f}\n`);
  }

  const installed = await maybeInstallDeps(target, flags);
  process.stdout.write([
    "",
    "next steps:",
    `  cd ${name}`,
    ...(installed ? [] : ["  npm install"]),
    "  npm run dev          # http://localhost:5173",
    "  npm run build        # produces dist/" + slug + ".html",
    "",
  ].join("\n"));
}

/* Install workbook dependencies inside <target>. Defaults to on so
 * sandboxes (E2B, Daytona, Vercel Sandbox, WebContainer) and agents
 * don't have to run an extra command before `workbook build`. Pass
 * `--no-install` to opt out. Picks bun if available (faster), falls
 * back to npm. WebContainer ships its own npm so this works there
 * too — the install runs in-browser via the WC nodejs runtime. */
async function maybeInstallDeps(target, flags) {
  if (flags.install === false || flags["no-install"] === true) {
    process.stdout.write("\n(skipping dependency install — pass --install or run `npm install` yourself)\n");
    return false;
  }
  const pkgPath = path.join(target, "package.json");
  try {
    await fs.access(pkgPath);
  } catch {
    return false;
  }
  const manager = await pickPackageManager();
  process.stdout.write(`\n→ installing dependencies with ${manager.label}…\n`);
  const t0 = Date.now();
  const code = await runQuiet(manager.bin, manager.args, target);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  if (code !== 0) {
    process.stderr.write(
      `\nworkbook init: dependency install failed (exit ${code}). ` +
        `Run \`cd ${path.basename(target)} && ${manager.label}\` manually before building.\n`,
    );
    return false;
  }
  process.stdout.write(`✓ installed in ${dur}s\n`);
  return true;
}

async function pickPackageManager() {
  if (await hasOnPath("bun")) {
    return { label: "bun install", bin: "bun", args: ["install"] };
  }
  return { label: "npm install", bin: "npm", args: ["install", "--no-audit", "--no-fund", "--loglevel=error"] };
}

function hasOnPath(name) {
  return new Promise((resolve) => {
    const probe = spawn(process.platform === "win32" ? "where" : "which", [name], {
      stdio: "ignore",
    });
    probe.on("exit", (code) => resolve(code === 0));
    probe.on("error", () => resolve(false));
  });
}

function runQuiet(bin, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

// Scaffold the playground + its sibling wrapped demo. The playground
// references the wrapped via a deterministic `<slug>-wrapped` name so
// the `wraps` field in workbook.config.mjs resolves on disk after both
// builds.
async function scaffoldPlaygroundPair({ name, slug, templateDir, force }) {
  const wrappedName = `${name}-wrapped`;
  const wrappedSlug = `${slug}-wrapped`;
  const wrappedTemplateDir = path.join(TEMPLATES_ROOT, "playground-wrapped");
  try {
    await fs.access(wrappedTemplateDir);
  } catch {
    process.stderr.write(
      `workbook init: template 'playground-wrapped' is missing on disk at ${wrappedTemplateDir} — packaging bug, please file an issue.\n`,
    );
    process.exit(2);
  }

  const playgroundTarget = path.resolve(name);
  const wrappedTarget = path.resolve(wrappedName);

  await assertWritable(playgroundTarget, force);
  await assertWritable(wrappedTarget, force);

  // Playground template gets %%WRAPPED_SLUG%% in addition to the base
  // tokens; the wrapped template uses only the base set, but seeded
  // with the wrapped's own name/slug.
  const playgroundReplacements = new Map([
    ...baseReplacements(name, slug),
    ["%%WRAPPED_SLUG%%", wrappedSlug],
  ]);
  const wrappedReplacements = new Map(baseReplacements(wrappedName, wrappedSlug));

  const playgroundFiles = await stamp(templateDir, playgroundTarget, playgroundReplacements);
  const wrappedFiles = await stamp(wrappedTemplateDir, wrappedTarget, wrappedReplacements);

  process.stdout.write(`✓ created ${path.relative(process.cwd(), playgroundTarget) || playgroundTarget}/\n`);
  for (const f of playgroundFiles.sort()) {
    process.stdout.write(`    ${f}\n`);
  }
  process.stdout.write(`✓ created ${path.relative(process.cwd(), wrappedTarget) || wrappedTarget}/\n`);
  for (const f of wrappedFiles.sort()) {
    process.stdout.write(`    ${f}\n`);
  }

  process.stdout.write([
    "",
    "next steps — build the wrapped demo first so the playground's wraps URL resolves:",
    `  cd ${wrappedName} && npm install && npm run build   # writes dist/${wrappedSlug}.html`,
    `  cd ../${name}     && npm install && npm run build   # writes dist/${slug}.html`,
    `  npm run dev                                         # http://localhost:5173`,
    "",
    "the wrapped workbook also runs standalone — open its dist .html in a browser",
    "to see the default state without the playground in the loop.",
    "",
  ].join("\n"));
}

function baseReplacements(name, slug) {
  return new Map([
    ["%%NAME%%", name],
    ["%%SLUG%%", slug],
    ["%%CLI_VERSION%%", `^${CLI_VERSION}`],
  ]);
}

async function assertWritable(target, force) {
  const exists = await fs.stat(target).catch(() => null);
  if (exists) {
    if (!exists.isDirectory()) {
      process.stderr.write(`workbook init: '${target}' exists and is not a directory\n`);
      process.exit(2);
    }
    const entries = await fs.readdir(target);
    if (entries.length > 0 && !force) {
      process.stderr.write(
        `workbook init: '${target}' is not empty (use --force to overwrite)\n`,
      );
      process.exit(2);
    }
  } else {
    await fs.mkdir(target, { recursive: true });
  }
}

async function stamp(templateDir, target, replacements) {
  const filesWritten = [];
  for await (const { abs, rel } of walk(templateDir)) {
    const dest = path.join(target, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const buf = await fs.readFile(abs);
    if (looksBinary(buf)) {
      await fs.writeFile(dest, buf);
    } else {
      let text = buf.toString("utf8");
      for (const [token, value] of replacements) {
        text = text.split(token).join(value);
      }
      await fs.writeFile(dest, text);
    }
    filesWritten.push(rel);
  }
  return filesWritten;
}

function toSlug(name) {
  const slug = String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

async function readCliVersion() {
  const pkgPath = path.resolve(HERE, "..", "..", "package.json");
  try {
    const text = await fs.readFile(pkgPath, "utf8");
    const m = /"version"\s*:\s*"([^"]+)"/.exec(text);
    return m ? m[1] : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function* walk(root, prefix = "") {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(root, ent.name);
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      yield* walk(abs, rel);
    } else if (ent.isFile()) {
      yield { abs, rel };
    }
  }
}

// Guard the placeholder substitution against binary files (icons, etc.).
function looksBinary(buf) {
  const slice = buf.subarray(0, Math.min(buf.length, 8000));
  for (const b of slice) {
    if (b === 0) return true;
  }
  return false;
}
