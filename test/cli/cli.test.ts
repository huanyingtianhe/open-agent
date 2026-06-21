import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { formatHelp, isDirectExecution, runCli, validateNodeVersion } from "../../src/cli.js";

test("validateNodeVersion accepts Node 20 and newer", () => {
  assert.equal(validateNodeVersion("20.0.0"), undefined);
  assert.equal(validateNodeVersion("22.10.0"), undefined);
});

test("validateNodeVersion rejects Node versions older than 20", () => {
  assert.equal(
    validateNodeVersion("18.19.0"),
    "openagent requires Node.js >=20. Current version is 18.19.0. Upgrade Node.js and try again.",
  );
});

test("formatHelp documents global openagent usage", () => {
  const help = formatHelp({
    name: "open-agent",
    version: "0.1.0",
    description: "A minimal Claude-Code-style agent.",
  });

  assert.match(help, /^openagent 0\.1\.0/m);
  assert.match(help, /Usage:\n  openagent \[options\]/m);
  assert.match(help, /Aliases:\n  open-agent/m);
  assert.match(help, /--cwd <path>/m);
  assert.match(help, /--yolo/m);
  assert.match(help, /--plan/m);
});

test("isDirectExecution compares file URLs with the executed argv path", () => {
  const file = process.platform === "win32" ? "C:\\repo\\dist\\cli.js" : "/repo/dist/cli.js";
  const url = pathToFileURL(file).href;

  assert.equal(isDirectExecution(url, file), true);
  assert.equal(isDirectExecution(url, undefined), false);
});

test("src/index.ts exports main without auto-starting the REPL when imported", async () => {
  const mod = await import("../../src/index.js");

  assert.equal(typeof mod.main, "function");
});

test("runCli prints version without validating runtime credentials", async () => {
  const originalLog = console.log;
  const output: string[] = [];
  console.log = (message?: unknown) => {
    output.push(String(message));
  };

  try {
    const code = await runCli(["--version"], "18.19.0");
    assert.equal(code, 0);
    assert.match(output.join("\n"), /^0\.1\.0$/m);
  } finally {
    console.log = originalLog;
  }
});

test("runCli prints help without entering the agent runtime", async () => {
  const originalLog = console.log;
  const output: string[] = [];
  console.log = (message?: unknown) => {
    output.push(String(message));
  };

  try {
    const code = await runCli(["--help"], "18.19.0");
    assert.equal(code, 0);
    assert.match(output.join("\n"), /Usage:\n  openagent \[options\]/m);
  } finally {
    console.log = originalLog;
  }
});

test("runCli rejects old Node versions before entering the agent runtime", async () => {
  const originalError = console.error;
  const output: string[] = [];
  console.error = (message?: unknown) => {
    output.push(String(message));
  };

  try {
    const code = await runCli([], "18.19.0");
    assert.equal(code, 1);
    assert.equal(
      output.join("\n"),
      "openagent requires Node.js >=20. Current version is 18.19.0. Upgrade Node.js and try again.",
    );
  } finally {
    console.error = originalError;
  }
});

test("npm test exercises the built CLI smoke path", () => {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "test:cli"], {
    encoding: "utf8",
    timeout: 120_000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n") || "npm run test:cli failed",
  );
});
