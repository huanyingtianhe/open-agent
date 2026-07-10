import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
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

test("isDirectExecution compares file URLs with the executed argv path", async () => {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".tmp-openagent-direct-"));
  const file = path.join(root, "dist", "cli.js");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "", "utf8");

  try {
    assert.equal(isDirectExecution(pathToFileURL(file).href, file), true);
    assert.equal(isDirectExecution(pathToFileURL(file).href, undefined), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("isDirectExecution resolves npm-style symlinked argv paths", async () => {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".tmp-openagent-bin-"));
  try {
    const realFile = path.join(root, "dist", "cli.js");
    const binFile = path.join(root, "bin", "openagent");
    await fs.mkdir(path.dirname(realFile), { recursive: true });
    await fs.mkdir(path.dirname(binFile), { recursive: true });
    await fs.writeFile(realFile, "", "utf8");

    try {
      await fs.symlink(realFile, binFile, "file");
      assert.equal(isDirectExecution(pathToFileURL(realFile).href, binFile), true);
    } catch {
      const fakeRealpath = (candidate: string): string =>
        path.resolve(candidate) === path.resolve(binFile) ? path.resolve(realFile) : path.resolve(candidate);
      assert.equal(isDirectExecution(pathToFileURL(realFile).href, binFile, fakeRealpath), true);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
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

test("built CLI smoke path prints help and version", () => {
  const tscPath = path.resolve("node_modules", "typescript", "bin", "tsc");
  const build = spawnSync(process.execPath, [tscPath], {
    encoding: "utf8",
    timeout: 120_000,
  });

  assert.equal(build.error, undefined, build.error?.message);
  assert.equal(
    build.status,
    0,
    [build.stdout, build.stderr].filter(Boolean).join("\n") || "TypeScript build failed",
  );

  const cliPath = path.resolve("dist", "cli.js");
  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(help.error, undefined, help.error?.message);
  assert.equal(help.status, 0, [help.stdout, help.stderr].filter(Boolean).join("\n"));
  assert.match(help.stdout, /^openagent 0\.1\.0/m);
  assert.match(help.stdout, /Usage:\n  openagent \[options\]/m);

  const version = spawnSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" });
  assert.equal(version.error, undefined, version.error?.message);
  assert.equal(version.status, 0, [version.stdout, version.stderr].filter(Boolean).join("\n"));
  assert.equal(version.stdout.trim(), "0.1.0");
});
