// Shared types for the agent.
// Kept in one file so each module has a single source of truth.

import type Anthropic from "@anthropic-ai/sdk";

// Re-export the API message shape so callers don't have to import the SDK.
export type ApiMessage = Anthropic.MessageParam;
export type ContentBlock = Anthropic.ContentBlock;
export type ToolUseBlock = Anthropic.ToolUseBlock;
export type ToolResultBlockParam = Anthropic.ToolResultBlockParam;

// ---- Tool ---------------------------------------------------------------

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  // JSON schema that the model sees.
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Handler executed when the model emits tool_use for this tool.
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput | ToolError>;
}

export interface ToolError {
  __toolError: true;
  message: string;
}

export function toolError(message: string): ToolError {
  return { __toolError: true, message };
}

export function isToolError(v: unknown): v is ToolError {
  return typeof v === "object" && v !== null && (v as ToolError).__toolError === true;
}

// ---- Context passed to every tool handler -------------------------------

export interface ToolContext {
  cwd: string;
  // Lets tools mutate shared session state (e.g. TodoWrite).
  state: SessionState;
  // Lets tools ask the agent to spawn a subagent / load a skill etc.
  hooks: {
    runSubagent: (prompt: string, allowedTools?: string[]) => Promise<string>;
    loadSkill: (skillName: string) => Promise<string>;
  };
}

// ---- Session state ------------------------------------------------------

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "blocked";
}

export interface SessionState {
  todos: TodoItem[];
  // Cumulative tokens for naive compaction trigger (s06).
  tokensUsed: number;
  // Effective working directory. Set by the `cd` tool (or `worktree_create
  // auto_cd: true`); falls back to AgentOptions.cwd. File and shell tools
  // read this on every call so a mid-loop cwd change is honoured immediately.
  cwd?: string;
}

export function newSessionState(): SessionState {
  return { todos: [], tokensUsed: 0 };
}

// ---- Permission pipeline result -----------------------------------------

export type PermissionDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; prompt: string };
