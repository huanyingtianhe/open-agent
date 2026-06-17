import { loadMcpConfig, type McpServerConfig } from "./config.js";
import { createMcpToolDefinition, type McpCallResultLike } from "./tools.js";
import type { ToolDefinition } from "../types.js";

interface McpServerState {
  name: string;
  status: "connected" | "failed";
  tools: number;
  error?: string;
  client?: McpClientLike;
}

interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  callTool(input: { name: string; arguments?: unknown }): Promise<McpCallResultLike>;
  close?(): Promise<void>;
}

export class McpManager {
  private states: McpServerState[] = [];
  private toolDefinitions: ToolDefinition[] = [];

  constructor(private rootDir: string) {}

  async load(): Promise<void> {
    const config = await loadMcpConfig(this.rootDir);
    for (const [name, server] of Object.entries(config.servers)) {
      await this.connectServer(name, server);
    }
  }

  tools(): ToolDefinition[] {
    return this.toolDefinitions;
  }

  summary(): string {
    if (this.states.length === 0) return "(no MCP servers configured)";
    return this.states
      .map((state) => {
        if (state.status === "failed") return `${state.name}: failed (${state.error})`;
        return `${state.name}: connected (${state.tools} tool(s))`;
      })
      .join("\n");
  }

  async close(): Promise<void> {
    await Promise.all(
      this.states.map(async (state) => {
        try {
          await state.client?.close?.();
        } catch {
          /* best effort shutdown */
        }
      }),
    );
  }

  private async connectServer(name: string, server: McpServerConfig): Promise<void> {
    try {
      const client = await createClient();
      const transport = await createTransport(server);
      await client.connect(transport);
      const listed = await client.listTools();
      const tools = listed.tools ?? [];
      for (const tool of tools) {
        this.toolDefinitions.push(
          createMcpToolDefinition(name, tool, async (toolName, input) =>
            client.callTool({ name: toolName, arguments: input ?? {} }),
          ),
        );
      }
      this.states.push({ name, status: "connected", tools: tools.length, client });
    } catch (err) {
      this.states.push({
        name,
        status: "failed",
        tools: 0,
        error: (err as Error).message,
      });
    }
  }
}

async function createClient(): Promise<McpClientLike> {
  const mod = (await importSdkModule("@modelcontextprotocol/sdk/client/index.js")) as {
    Client: new (info: { name: string; version: string }) => McpClientLike;
  };
  return new mod.Client({ name: "open-agent", version: "0.1.0" });
}

async function createTransport(server: McpServerConfig): Promise<unknown> {
  if (server.transport === "stdio") {
    const mod = (await importSdkModule("@modelcontextprotocol/sdk/client/stdio.js")) as {
      StdioClientTransport: new (config: {
        command: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
      }) => unknown;
    };
    return new mod.StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: server.env,
    });
  }

  if (server.transport === "sse") {
    const mod = (await importSdkModule("@modelcontextprotocol/sdk/client/sse.js")) as {
      SSEClientTransport: new (url: URL, options?: { requestInit?: { headers?: Record<string, string> } }) => unknown;
    };
    return new mod.SSEClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    });
  }

  const mod = (await importSdkModule("@modelcontextprotocol/sdk/client/streamableHttp.js")) as {
    StreamableHTTPClientTransport: new (
      url: URL,
      options?: { requestInit?: { headers?: Record<string, string> } },
    ) => unknown;
  };
  return new mod.StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: server.headers },
  });
}

function importSdkModule(specifier: string): Promise<unknown> {
  return import(specifier);
}