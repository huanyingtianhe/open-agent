// memorize / recall / forget tools, backed by MemoryStore.

import { toolError, type ToolDefinition } from "../types.js";
import type { MemoryStore } from "../memory/store.js";

export function makeMemorizeTool(store: MemoryStore): ToolDefinition {
  return {
    name: "memorize",
    description:
      "Save a short note to long-term memory under a key. Overwrites if the key exists. " +
      "Use for facts the user wants you to remember across sessions (preferences, " +
      "project conventions, gotchas). Don't use it as scratch space.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Short kebab-case identifier." },
        value: { type: "string", description: "The note to remember." },
      },
      required: ["key", "value"],
    },
    handler: async (input: any) => {
      if (!input.key || !input.value) return toolError("key and value are required");
      await store.set(input.key, input.value);
      return `Remembered "${input.key}".`;
    },
  };
}

export function makeRecallTool(store: MemoryStore): ToolDefinition {
  return {
    name: "recall",
    description:
      "Look up the full text of a remembered note by key. The system prompt shows " +
      "a truncated index of all keys; use this tool to read the full value.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    handler: async (input: any) => {
      const v = store.get(input.key);
      if (v === undefined) return toolError(`No memory under key "${input.key}".`);
      return v;
    },
  };
}

export function makeForgetTool(store: MemoryStore): ToolDefinition {
  return {
    name: "forget",
    description: "Delete a remembered note by key.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    handler: async (input: any) => {
      const ok = await store.delete(input.key);
      return ok ? `Forgot "${input.key}".` : `No such key "${input.key}".`;
    },
  };
}
