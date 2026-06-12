// Anthropic <-> OpenAI message-format translation, shared by every provider
// that speaks the OpenAI chat-completions protocol (GitHub Copilot, Azure
// OpenAI, vanilla OpenAI, Ollama-in-openai-mode, etc.).
//
// The agent loop is hard-coded to Anthropic-shaped content blocks. Translating
// only at the boundary keeps the rest of the codebase oblivious.

import type {
  ApiMessage,
  ContentBlock,
  ToolDefinition,
  ToolResultBlockParam,
  ToolUseBlock,
} from "../types.js";
import type { CallModelResponse } from "./types.js";

// ---- OpenAI chat-completions schema (subset we use) --------------------

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIChatResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ---- Anthropic -> OpenAI --------------------------------------------------

export function toOpenAIMessages(system: string, messages: ApiMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }

    if (m.role === "user") {
      // Split user blocks: text -> single user msg; tool_results -> one "tool" msg each.
      const textParts: string[] = [];
      const toolMsgs: OpenAIMessage[] = [];
      for (const block of m.content) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "tool_result") {
          const tr = block as ToolResultBlockParam;
          const content =
            typeof tr.content === "string"
              ? tr.content
              : Array.isArray(tr.content)
                ? tr.content
                    .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
                    .join("\n")
                : JSON.stringify(tr.content ?? "");
          toolMsgs.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: tr.is_error ? `[error] ${content}` : content,
          });
        }
      }
      if (textParts.length > 0) out.push({ role: "user", content: textParts.join("\n") });
      out.push(...toolMsgs);
      continue;
    }

    if (m.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];
      for (const block of m.content) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "tool_use") {
          const tu = block as ToolUseBlock;
          toolCalls.push({
            id: tu.id,
            type: "function",
            function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
          });
        }
      }
      out.push({
        role: "assistant",
        content: textParts.join("\n") || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    }
  }
  return out;
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ---- OpenAI response -> Anthropic normalized response --------------------

export function fromOpenAIResponse(resp: OpenAIChatResponse): CallModelResponse {
  const choice = resp.choices?.[0];
  if (!choice) {
    return {
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const blocks: ContentBlock[] = [];
  if (choice.message.content) {
    blocks.push({ type: "text", text: choice.message.content, citations: null } as ContentBlock);
  }
  for (const tc of choice.message.tool_calls ?? []) {
    let parsed: unknown = {};
    try {
      parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      parsed = { _raw: tc.function.arguments };
    }
    blocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: parsed,
    } as ContentBlock);
  }

  return {
    content: blocks,
    stop_reason: mapFinishReason(choice.finish_reason),
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

function mapFinishReason(r: string | null): string {
  switch (r) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
    case "content_filter":
    case null:
    case undefined:
      return "end_turn";
    default:
      return r;
  }
}

// ---- Shared HTTP POST helper --------------------------------------------

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${text.slice(0, 500)}`);
  }
  return res.json();
}
