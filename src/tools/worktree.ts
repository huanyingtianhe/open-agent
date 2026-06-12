import { toolError, type ToolDefinition } from "../types.js";
import type { WorktreeManager } from "../worktree/manager.js";

export function makeWorktreeCreateTool(mgr: WorktreeManager): ToolDefinition {
  return {
    name: "worktree_create",
    description:
      "Create an isolated git worktree on a new branch. Returns its absolute path. " +
      "Use when running a task that should not contaminate the main checkout " +
      "(parallel refactors, experiments). Set auto_cd=true to also change the " +
      "session cwd into the new worktree.",
    input_schema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "New branch name. Must not already exist." },
        base: { type: "string", default: "HEAD", description: "Commit-ish to branch from." },
        auto_cd: {
          type: "boolean",
          default: false,
          description: "If true, set the session cwd to the worktree path after creating it.",
        },
      },
      required: ["branch"],
    },
    handler: async (input: any, ctx) => {
      try {
        const wt = await mgr.create(input.branch, input.base ?? "HEAD");
        if (input.auto_cd) {
          ctx.state.cwd = wt.path;
          ctx.cwd = wt.path;
          return `Worktree at ${wt.path} (branch ${wt.branch}, base ${wt.base}). cwd -> ${wt.path}`;
        }
        return `Worktree at ${wt.path} (branch ${wt.branch}, base ${wt.base})`;
      } catch (e) {
        return toolError((e as Error).message);
      }
    },
  };
}

export function makeWorktreeRemoveTool(mgr: WorktreeManager): ToolDefinition {
  return {
    name: "worktree_remove",
    description: "Remove a worktree (and its branch). Use after merging or abandoning work.",
    input_schema: {
      type: "object",
      properties: {
        branch: { type: "string" },
        keep_branch: { type: "boolean", default: false },
      },
      required: ["branch"],
    },
    handler: async (input: any) => {
      try {
        await mgr.remove(input.branch, !input.keep_branch);
        return `Removed worktree ${input.branch}.`;
      } catch (e) {
        return toolError((e as Error).message);
      }
    },
  };
}

export function makeWorktreeListTool(mgr: WorktreeManager): ToolDefinition {
  return {
    name: "worktree_list",
    description: "List all worktrees this session has created.",
    input_schema: { type: "object", properties: {} },
    handler: async () => {
      const ws = mgr.list();
      if (ws.length === 0) return "(no worktrees)";
      return ws.map((w) => `${w.branch}  ${w.path}  (from ${w.base})`).join("\n");
    },
  };
}
