// Shared LLM types.
//
// The agent loop only ever sees Anthropic-shaped messages and content blocks.
// Non-Anthropic providers translate at their boundary -- the loop, tools,
// hooks, and skills don't know which backend is in use.

import type { ApiMessage, ContentBlock, ToolDefinition } from "../types.js";

export interface CallModelOptions {
  system: string;
  messages: ApiMessage[];
  tools: ToolDefinition[];
  model?: string;
  maxTokens?: number;
}

// Normalized response shape. Matches Anthropic's Message shape closely so the
// agent loop can stay as-is.
export interface CallModelResponse {
  content: ContentBlock[];
  // We accept any string; the agent loop only checks `=== "tool_use"`.
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface Provider {
  readonly name: string;
  callModel(opts: CallModelOptions): Promise<CallModelResponse>;
}

export type ProviderId = "anthropic" | "copilot" | "azure-openai";
