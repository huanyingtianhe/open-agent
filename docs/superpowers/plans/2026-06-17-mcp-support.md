# MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real MCP server support so tools exposed by configured MCP servers are available in the open-agent tool registry.

**Architecture:** Read `.open-agent/mcp.json`, connect each configured server through the official MCP SDK, convert listed MCP tools into namespaced `ToolDefinition`s, and register them beside native tools. Keep MCP-specific lifecycle and conversion code under `src/mcp/` so the agent loop remains unchanged.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk`, existing `ToolRegistry` and `ToolDefinition` interfaces.

## Global Constraints

- Support `stdio`, `sse`, and `http` MCP transports in the first implementation.
- MCP tools must be namespaced as `mcp__<server>__<tool>` to avoid collisions.
- A failed MCP server must warn and let the agent continue starting.
- MCP tool call failures must return `toolError(...)`, not crash the agent loop.
- `.open-agent/mcp.json` is optional; missing config means zero MCP servers.

---

### Task 1: Pure Config And Tool Mapping

**Files:**
- Create: `src/mcp/config.ts`
- Create: `src/mcp/tools.ts`
- Create: `src/mcp/tools.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadMcpConfig(rootDir: string): Promise<McpConfig>`
- Produces: `makeMcpToolName(serverName: string, toolName: string): string`
- Produces: `createMcpToolDefinition(serverName, tool, callTool): ToolDefinition`

- [x] Write tests for namespacing and result formatting in `src/mcp/tools.test.ts`.
- [x] Add a `test` script that builds TypeScript and runs compiled Node tests.
- [x] Implement `config.ts` and `tools.ts` with no SDK dependency.
- [ ] Run `npm test` and confirm the new tests pass.

### Task 2: MCP Runtime Manager

**Files:**
- Create: `src/mcp/manager.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadMcpConfig(...)` and `createMcpToolDefinition(...)`
- Produces: `McpManager.load(): Promise<void>`
- Produces: `McpManager.tools(): ToolDefinition[]`
- Produces: `McpManager.summary(): string`
- Produces: `McpManager.close(): Promise<void>`

- [x] Add `@modelcontextprotocol/sdk` as a dependency.
- [x] Implement stdio, SSE, and streamable HTTP transport creation through dynamic SDK imports.
- [x] Connect each configured server, list tools, and convert them into `ToolDefinition`s.
- [x] Handle server connection and tool call failures without crashing startup.

### Task 3: CLI Wiring And Docs

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `McpManager` from Task 2.
- Produces: `/mcp` REPL command.

- [x] Instantiate and load `McpManager` after plugins are loaded.
- [x] Register all MCP tool definitions after plugin tools.
- [x] Include MCP server/tool counts in the startup banner.
- [x] Add `/mcp` to the command list and command handler.
- [x] Document `.open-agent/mcp.json` examples for stdio, SSE, and HTTP.
- [ ] Run `npm run typecheck` and `npm test`.
