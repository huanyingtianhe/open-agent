import assert from "node:assert/strict";
import test from "node:test";

import { createMcpToolDefinition, formatMcpToolResult, makeMcpToolName } from "./tools.js";

test("makeMcpToolName namespaces server and tool names", () => {
  assert.equal(makeMcpToolName("local-fs", "read.file"), "mcp__local_fs__read_file");
});

test("createMcpToolDefinition forwards input to the MCP call", async () => {
  const calls: unknown[] = [];
  const tool = createMcpToolDefinition(
    "demo",
    {
      name: "echo",
      description: "Echo input",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    async (name, input) => {
      calls.push({ name, input });
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  const result = await tool.handler({ text: "hello" }, {} as never);

  assert.equal(tool.name, "mcp__demo__echo");
  assert.equal(result, "ok");
  assert.deepEqual(calls, [{ name: "echo", input: { text: "hello" } }]);
});

test("formatMcpToolResult serializes mixed MCP content", () => {
  assert.equal(
    formatMcpToolResult({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
    }),
    'hello\n{"type":"image","data":"abc","mimeType":"image/png"}',
  );
});