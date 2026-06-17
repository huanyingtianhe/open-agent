import { toolError, type ToolDefinition } from "../types.js";

export interface McpToolLike {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResultLike {
  content?: unknown[];
  isError?: boolean;
}

export type McpCallTool = (toolName: string, input: unknown) => Promise<McpCallResultLike>;

export function makeMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeName(serverName)}__${sanitizeName(toolName)}`;
}

export function createMcpToolDefinition(
  serverName: string,
  tool: McpToolLike,
  callTool: McpCallTool,
): ToolDefinition {
  return {
    name: makeMcpToolName(serverName, tool.name),
    description: `[MCP:${serverName}] ${tool.description || tool.name}`,
    input_schema: normalizeInputSchema(tool.inputSchema),
    handler: async (input: unknown) => {
      try {
        const result = await callTool(tool.name, input ?? {});
        const formatted = formatMcpToolResult(result);
        return result.isError ? toolError(formatted) : formatted;
      } catch (err) {
        return toolError(`MCP tool ${serverName}/${tool.name} failed: ${(err as Error).message}`);
      }
    },
  };
}

export function formatMcpToolResult(result: McpCallResultLike): string {
  const content = result.content ?? [];
  if (content.length === 0) return "(empty MCP result)";
  return content.map(formatMcpContent).join("\n");
}

function formatMcpContent(value: unknown): string {
  if (isRecord(value) && value.type === "text" && typeof value.text === "string") {
    return value.text;
  }
  return JSON.stringify(value);
}

function normalizeInputSchema(schema: unknown): ToolDefinition["input_schema"] {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties)) {
    return { type: "object", properties: {} };
  }
  return {
    type: "object",
    properties: schema.properties,
    required: Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function sanitizeName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "unnamed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}