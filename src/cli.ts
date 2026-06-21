#!/usr/bin/env node

import path from "node:path";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { main } from "./index.js";

interface PackageInfo {
  name: string;
  version: string;
  description?: string;
}

export function validateNodeVersion(version: string = process.versions.node): string | undefined {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 20) {
    return `openagent requires Node.js >=20. Current version is ${version}. Upgrade Node.js and try again.`;
  }
  return undefined;
}

export function formatHelp(pkg: PackageInfo): string {
  const description = pkg.description ? `\n${pkg.description}\n` : "";
  return `openagent ${pkg.version}${description}
Usage:
  openagent [options]

Aliases:
  open-agent

Options:
  --cwd <path>    Run the agent with a specific working directory
  --yolo          Auto-approve all tools
  --plan          Block writes; planning only
  --cron          Start the cron scheduler
  --autonomous    Start the autonomous teammate loop
  --version, -v   Print the package version
  --help, -h      Print this help message

Examples:
  openagent
  openagent --cwd C:\\path\\to\\project
  openagent --yolo
`;
}

export function isDirectExecution(
  importMetaUrl: string,
  argvPath: string | undefined = process.argv[1],
  realpath: (path: string) => string = realpathSync.native,
): boolean {
  if (!argvPath) return false;
  return realpath(path.resolve(fileURLToPath(importMetaUrl))) === realpath(path.resolve(argvPath));
}

function readPackageInfo(): PackageInfo {
  const require = createRequire(import.meta.url);
  return require("../package.json") as PackageInfo;
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  nodeVersion: string = process.versions.node,
): Promise<number> {
  const pkg = readPackageInfo();

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(formatHelp(pkg));
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(pkg.version);
    return 0;
  }

  const versionError = validateNodeVersion(nodeVersion);
  if (versionError) {
    console.error(versionError);
    return 1;
  }

  await main(argv);
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  runCli()
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
      process.exitCode = 1;
    });
}
