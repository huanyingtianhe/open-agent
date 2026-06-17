import { promises as fs } from "node:fs";
import path from "node:path";

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig | McpHttpServerConfig;

export interface McpStdioServerConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface McpSseServerConfig {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpHttpServerConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

const CONFIG_FILE = path.join(".open-agent", "mcp.json");

export async function loadMcpConfig(rootDir: string): Promise<McpConfig> {
  const file = path.join(rootDir, CONFIG_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return { servers: {} };
  }

  const parsed = JSON.parse(raw) as unknown;
  return normalizeConfig(parsed);
}

function normalizeConfig(value: unknown): McpConfig {
  if (!isRecord(value)) throw new Error("mcp config must be an object");
  const servers = value.servers;
  if (!isRecord(servers)) throw new Error("mcp config must include a servers object");

  const normalized: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    if (!isSafeName(name)) throw new Error(`invalid MCP server name: ${name}`);
    normalized[name] = normalizeServerConfig(name, config);
  }
  return { servers: normalized };
}

function normalizeServerConfig(name: string, value: unknown): McpServerConfig {
  if (!isRecord(value)) throw new Error(`MCP server ${name} must be an object`);
  if (value.transport === "stdio") {
    if (typeof value.command !== "string" || !value.command.trim()) {
      throw new Error(`MCP stdio server ${name} requires command`);
    }
    return {
      transport: "stdio",
      command: expandEnv(value.command),
      args: optionalStringArray(value.args, `${name}.args`)?.map(expandEnv),
      cwd: optionalString(value.cwd, `${name}.cwd`),
      env: optionalStringRecord(value.env, `${name}.env`),
    };
  }
  if (value.transport === "sse" || value.transport === "http") {
    if (typeof value.url !== "string" || !value.url.trim()) {
      throw new Error(`MCP ${value.transport} server ${name} requires url`);
    }
    return {
      transport: value.transport,
      url: expandEnv(value.url),
      headers: optionalStringRecord(value.headers, `${name}.headers`),
    };
  }
  throw new Error(`MCP server ${name} has unsupported transport`);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function optionalStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new Error(`${label}.${key} must be a string`);
    out[key] = expandEnv(item);
  }
  return out;
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => process.env[name] ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeName(value: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(value);
}