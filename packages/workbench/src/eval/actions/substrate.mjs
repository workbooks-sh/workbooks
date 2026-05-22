// Cleanup actions for the substrate. Distinct from checks: actions
// mutate, checks observe.

import { promises as fs } from "node:fs";
import path from "node:path";

export const substrateActions = {
  "substrate.remove_path": async (ctx, params) => {
    if (!params || typeof params.path !== "string") {
      throw new Error(`substrate.remove_path: requires "path" (string)`);
    }
    const removed = await ctx.substrate.removePath(params.path, {
      message: params.message ?? `eval cleanup: remove ${params.path}`,
    });
    return { ok: true, removed };
  },

  // Writes a file into the substrate clone and pushes it. Used in
  // setup blocks to set up cross-surface evals (CLI push, then the
  // turn asks the agent to read the file back).
  "substrate.write_path": async (ctx, params) => {
    if (!params || typeof params.path !== "string") {
      throw new Error(`substrate.write_path: requires "path" (string)`);
    }
    if (typeof params.content !== "string" && typeof params.base64 !== "string") {
      throw new Error(`substrate.write_path: requires "content" (string) or "base64"`);
    }
    const dir = await ctx.substrate.ensureClone();
    await ctx.substrate.refresh();
    const buf = typeof params.content === "string"
      ? Buffer.from(params.content, "utf8")
      : Buffer.from(params.base64, "base64");
    const pushed = await ctx.substrate.commitAndPush(
      params.message ?? `eval setup: write ${params.path}`,
      async (rootDir) => {
        const abs = path.resolve(rootDir, params.path);
        if (!abs.startsWith(rootDir + path.sep)) {
          throw new Error(`substrate.write_path: ${params.path} escapes substrate root`);
        }
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, buf);
      },
    );
    return { ok: true, pushed };
  },
};
