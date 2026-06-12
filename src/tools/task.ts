// Tools that expose the durable TaskGraph (s12) to the model.

import { toolError, type ToolDefinition } from "../types.js";
import type { TaskGraph } from "../tasks/graph.js";

export function makeTaskCreateTool(graph: TaskGraph): ToolDefinition {
  return {
    name: "task_create",
    description:
      "Create a durable task. Survives process restart. Use when work spans multiple " +
      "sessions or has explicit dependencies. For in-session checklists use todo_write.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string", default: "" },
        deps: {
          type: "array",
          items: { type: "string" },
          description: "IDs of tasks that must be 'done' before this one becomes 'ready'.",
        },
        worktree: { type: "string", description: "Optional git worktree path (s18)." },
      },
      required: ["title"],
    },
    handler: async (input: any) => {
      const t = await graph.create(input);
      return `Created task ${t.id} (${t.status}): ${t.title}`;
    },
  };
}

export function makeTaskUpdateTool(graph: TaskGraph): ToolDefinition {
  return {
    name: "task_update",
    description:
      "Update a task's status, result, or error. Use to mark a task in_progress, " +
      "done, failed, or blocked. Dependent tasks automatically advance when their deps complete.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "ready", "in_progress", "done", "failed", "blocked"],
        },
        result: { type: "string" },
        error: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (input: any) => {
      try {
        const t = await graph.update(input.id, {
          status: input.status,
          result: input.result,
          error: input.error,
        });
        return `Task ${t.id} -> ${t.status}`;
      } catch (e) {
        return toolError((e as Error).message);
      }
    },
  };
}

export function makeTaskListTool(graph: TaskGraph): ToolDefinition {
  return {
    name: "task_list",
    description:
      "List durable tasks. Optionally filter by status. Returns a compact table.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "ready", "in_progress", "done", "failed", "blocked"],
        },
      },
    },
    handler: async (input: any) => {
      const items = graph.list(input?.status ? { status: input.status } : undefined);
      if (items.length === 0) return "(no tasks)";
      return items
        .map((t) => `${t.id}  [${t.status.padEnd(11)}] ${t.title}${t.deps.length ? `  deps=${t.deps.join(",")}` : ""}`)
        .join("\n");
    },
  };
}
