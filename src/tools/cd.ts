// `cd` tool: changes the effective working directory for subsequent tool calls
// within this session. Stored on SessionState.cwd, refreshed into ctx.cwd at
// the top of every agent loop iteration so file/shell tools see it immediately.

import { promises as fs } from "node:fs";
import path from "node:path";
import { toolError, type ToolDefinition } from "../types.js";

interface Input {
  path: string;
}

export const cdTool: ToolDefinition<Input, string> = {
  name: "cd",
  description:
    "Change the agent's working directory for the rest of the session. Affects " +
    "read_file, write_file, run_shell, and any other path-relative tool. Pass an " +
    "absolute path, or a path relative to the current cwd. Use this after " +
    "worktree_create to move work into the new worktree.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative directory path." },
    },
    required: ["path"],
  },
  handler: async (input, ctx) => {
    const target = path.isAbsolute(input.path) ? input.path : path.resolve(ctx.cwd, input.path);
    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) return toolError(`Not a directory: ${target}`);
    } catch (err) {
      return toolError(`cd failed: ${(err as Error).message}`);
    }
    ctx.state.cwd = target;
    // Also update ctx.cwd immediately so a same-iteration follow-up tool sees it.
    ctx.cwd = target;
    return `cwd -> ${target}`;
  },
};
