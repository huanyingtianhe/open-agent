// s04 Subagent: a context boundary, not a process trick.
// The parent passes a prompt and an optional tool allow-list. The subagent
// runs its own loop with its own message history and returns text only.

import type { ToolDefinition } from "../types.js";

interface Input {
  prompt: string;
  allowed_tools?: string[];
}

export const subagentTool: ToolDefinition<Input, string> = {
  name: "subagent",
  description:
    "Spawn a fresh subagent with its own context. Pass a self-contained prompt and an " +
    "optional allowed_tools list. Returns the subagent's final text response only.",
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Self-contained task description; the subagent sees no parent history.",
      },
      allowed_tools: {
        type: "array",
        items: { type: "string" },
        description: "Tool names the subagent may call. Omit for read-only defaults.",
      },
    },
    required: ["prompt"],
  },
  handler: async (input, ctx) => {
    return ctx.hooks.runSubagent(input.prompt, input.allowed_tools);
  },
};
