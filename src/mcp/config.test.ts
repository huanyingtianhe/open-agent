import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { loadMcpConfig } from "./config.js";

test("loadMcpConfig returns no servers when config is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open-agent-mcp-"));

  assert.deepEqual(await loadMcpConfig(root), { servers: {} });
});

test("loadMcpConfig reads stdio and http servers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open-agent-mcp-"));
  await fs.mkdir(path.join(root, ".open-agent"));
  process.env.MCP_TEST_TOKEN = "secret-token";
  await fs.writeFile(
    path.join(root, ".open-agent", "mcp.json"),
    JSON.stringify({
      servers: {
        fs: { transport: "stdio", command: "node", args: ["server.js"] },
        remote: {
          transport: "http",
          url: "https://example.com/mcp",
          headers: { authorization: "Bearer ${MCP_TEST_TOKEN}" },
        },
      },
    }),
    "utf8",
  );

  const config = await loadMcpConfig(root);

  assert.deepEqual(config.servers.fs, {
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    cwd: undefined,
    env: undefined,
  });
  assert.deepEqual(config.servers.remote, {
    transport: "http",
    url: "https://example.com/mcp",
    headers: { authorization: "Bearer secret-token" },
  });
});