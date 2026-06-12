// s03 TodoWrite: a visible plan that keeps the agent on track.
// The list lives in SessionState; this tool is just a CRUD facade
// that returns the whole list so the model sees the new state.

import { toolError, type ToolDefinition, type TodoItem } from "../types.js";

interface Input {
  todos: Array<{
    id: string;
    title: string;
    status: "pending" | "in_progress" | "done" | "blocked";
  }>;
}

function render(todos: TodoItem[]): string {
  if (todos.length === 0) return "(no todos)";
  const icon = { pending: "[ ]", in_progress: "[~]", done: "[x]", blocked: "[!]" } as const;
  return todos.map((t) => `${icon[t.status]} ${t.id}  ${t.title}`).join("\n");
}

export const todoWriteTool: ToolDefinition<Input, string> = {
  name: "todo_write",
  description:
    "Replace the current todo list. Use kebab-case ids and gerund-form titles. " +
    "Mark exactly one as in_progress while you work; flip to done immediately on completion.",
  input_schema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "done", "blocked"],
            },
          },
          required: ["id", "title", "status"],
        },
      },
    },
    required: ["todos"],
  },
  handler: async (input, ctx) => {
    const inProgress = input.todos.filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      return toolError(`Only one todo may be in_progress at a time (found ${inProgress.length}).`);
    }
    ctx.state.todos = input.todos.map((t) => ({ ...t }));
    return render(ctx.state.todos);
  },
};
