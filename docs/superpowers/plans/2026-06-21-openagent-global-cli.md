# OpenAgent Global CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the package install globally with `npm install -g open-agent` and start from any project with `openagent`.

**Architecture:** Keep `src/index.ts` as the runtime entrypoint and add a thin `src/cli.ts` package bootstrap for `--help`, `--version`, Node version validation, and argument forwarding. Expose both `openagent` and `open-agent` bin aliases to the built CLI file.

**Tech Stack:** TypeScript ESM (`moduleResolution: NodeNext`), Node.js `>=20`, Node built-in test runner through `tsx --test`.

## Global Constraints

- Node.js must remain `>=20`.
- Primary command must be `openagent`.
- Compatibility command must remain `open-agent`.
- `npm install -g open-agent` followed by `openagent` is the target install/start flow.
- `.env` stays project-local and is read from the user's current working directory.
- Packaged runtime assets include `dist/`, `skills/`, `plugins/`, `.env.example`, and `README.md`.
- The agent loop, tool behavior, model providers, permission model, and durable state layout must not change.

---

## File Structure

- Create `src/cli.ts`: package-facing bootstrap. Owns CLI help/version output, Node version validation, and calls `main(argv)` from `src/index.ts`.
- Modify `src/index.ts`: export `main(argv?: string[])`, accept forwarded argv, and only auto-run when executed directly.
- Create `test/cli/cli.test.ts`: unit tests for bootstrap helpers without entering the REPL.
- Create `test/cli/package.test.ts`: validates package bin aliases, files list, and scripts.
- Modify `package.json`: point `main` and both `bin` commands to `dist/cli.js`, add publish files and CLI smoke script.
- Modify `README.md`: update quick start from `npm run dev`-only to global install plus local development commands.
- Create `skills/.gitkeep`: ensures the package-local `skills/` directory exists in source and npm file lists.

---

### Task 1: Add testable CLI bootstrap helpers

**Files:**
- Create: `src/cli.ts`
- Create: `test/cli/cli.test.ts`

**Interfaces:**
- Consumes: no project interfaces yet.
- Produces:
  - `validateNodeVersion(version: string): string | undefined`
  - `formatHelp(pkg: { name: string; version: string; description?: string }): string`
  - `isDirectExecution(importMetaUrl: string, argvPath?: string): boolean`
  - `runCli(argv?: string[], nodeVersion?: string): Promise<number>`

- [ ] **Step 1: Write the failing CLI helper tests**

Create `test/cli/cli.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { formatHelp, isDirectExecution, validateNodeVersion } from "../../src/cli.js";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```pwsh
npm test -- --test-name-pattern "validateNodeVersion|formatHelp|isDirectExecution"
```

Expected: FAIL because `src/cli.ts` does not exist or does not export the tested functions.

- [ ] **Step 3: Implement the CLI bootstrap helpers and command dispatch**

Create `src/cli.ts`:

```ts
#!/usr/bin/env node

import path from "node:path";
import { createRequire } from "node:module";
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

export function isDirectExecution(importMetaUrl: string, argvPath: string | undefined = process.argv[1]): boolean {
  if (!argvPath) return false;
  return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(argvPath);
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
  runCli().then((code) => {
    if (code !== 0) process.exitCode = code;
  }).catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:

```pwsh
npm test -- --test-name-pattern "validateNodeVersion|formatHelp|isDirectExecution"
```

Expected: PASS for all four tests in `test/cli/cli.test.ts`.

- [ ] **Step 5: Commit Task 1**

Run:

```pwsh
git add src\cli.ts test\cli\cli.test.ts
git commit -m "Add openagent CLI bootstrap helpers" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds when Git author identity is configured.

---

### Task 2: Make the runtime import-safe and argv-forwardable

**Files:**
- Modify: `src/index.ts:4-7`
- Modify: `src/index.ts:84-87`
- Modify: `src/index.ts:145-147`
- Modify: `src/index.ts:454-457`

**Interfaces:**
- Consumes:
  - `isDirectExecution(importMetaUrl: string, argvPath?: string): boolean` from `src/cli.ts` is not imported here to avoid a runtime cycle.
- Produces:
  - `main(argv?: string[]): Promise<void>` exported from `src/index.ts`
  - `parseArgs(argv: string[]): Args` remains internal.

- [ ] **Step 1: Write the failing import-safety test**

Append this test to `test/cli/cli.test.ts`:

```ts
test("src/index.ts exports main without auto-starting the REPL when imported", async () => {
  const mod = await import("../../src/index.js");

  assert.equal(typeof mod.main, "function");
});
```

- [ ] **Step 2: Run the test to verify it fails or hangs before the fix**

Run:

```pwsh
npm test -- --test-name-pattern "exports main without auto-starting"
```

Expected: FAIL because `main` is not exported, or the test hangs because importing `src/index.ts` starts the REPL.

- [ ] **Step 3: Update imports and add direct-execution detection**

Modify the import block in `src/index.ts` so the URL import includes `pathToFileURL`:

```ts
import { fileURLToPath, pathToFileURL } from "node:url";
```

After the existing `__dirname` declaration, add this local helper:

```ts
function isDirectExecution(importMetaUrl: string, argvPath: string | undefined = process.argv[1]): boolean {
  if (!argvPath) return false;
  return pathToFileURL(path.resolve(argvPath)).href === importMetaUrl;
}
```

- [ ] **Step 4: Export `main` and forward argv**

Change the function signature and args parsing in `src/index.ts`:

```ts
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await loadDotenv();
  const args = parseArgs(argv);
```

- [ ] **Step 5: Guard direct runtime execution**

Replace the final `main().catch(...)` block in `src/index.ts` with:

```ts
if (isDirectExecution(import.meta.url)) {
  main().catch((err) => {
    log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
```

- [ ] **Step 6: Run the import-safety test to verify it passes**

Run:

```pwsh
npm test -- --test-name-pattern "exports main without auto-starting"
```

Expected: PASS and the test process exits without waiting for REPL input.

- [ ] **Step 7: Run the CLI helper tests again**

Run:

```pwsh
npm test -- --test-name-pattern "validateNodeVersion|formatHelp|isDirectExecution|exports main without auto-starting"
```

Expected: PASS for the CLI tests.

- [ ] **Step 8: Commit Task 2**

Run:

```pwsh
git add src\index.ts test\cli\cli.test.ts
git commit -m "Make agent runtime import-safe" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds when Git author identity is configured.

---

### Task 3: Wire npm bin aliases and publish files

**Files:**
- Modify: `package.json`
- Create: `test/cli/package.test.ts`
- Create: `skills/.gitkeep`

**Interfaces:**
- Consumes:
  - Built CLI entrypoint: `dist/cli.js`
- Produces:
  - npm bin alias `openagent`
  - npm bin alias `open-agent`
  - npm package file allowlist containing runtime assets
  - script `test:cli`

- [ ] **Step 1: Write the failing package metadata tests**

Create `test/cli/package.test.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const packageJsonPath = path.resolve("package.json");

async function readPackageJson(): Promise<{
  main?: string;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
}> {
  return JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
}

test("package exposes openagent and open-agent bin aliases through dist/cli.js", async () => {
  const pkg = await readPackageJson();

  assert.equal(pkg.main, "dist/cli.js");
  assert.deepEqual(pkg.bin, {
    openagent: "dist/cli.js",
    "open-agent": "dist/cli.js",
  });
});

test("package publish files include built runtime assets", async () => {
  const pkg = await readPackageJson();

  assert.deepEqual(pkg.files, ["dist/", "skills/", "plugins/", ".env.example", "README.md"]);
});

test("package defines a built CLI smoke test script", async () => {
  const pkg = await readPackageJson();

  assert.equal(pkg.scripts?.["test:cli"], "npm run build && node dist/cli.js --help && node dist/cli.js --version");
});
```

- [ ] **Step 2: Run the package metadata tests to verify they fail**

Run:

```pwsh
npm test -- --test-name-pattern "package exposes|package publish|built CLI smoke"
```

Expected: FAIL because `package.json` still points `bin.open-agent` at `dist/index.js`, lacks `openagent`, lacks `files`, and lacks `test:cli`.

- [ ] **Step 3: Update `package.json`**

Modify the top of `package.json` to match:

```json
{
  "name": "open-agent",
  "version": "0.1.0",
  "description": "A minimal Claude-Code-style agent. Implements chapters s01-s07 of https://learn.shareai.run/en/",
  "type": "module",
  "main": "dist/cli.js",
  "bin": {
    "openagent": "dist/cli.js",
    "open-agent": "dist/cli.js"
  },
  "files": [
    "dist/",
    "skills/",
    "plugins/",
    ".env.example",
    "README.md"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "test": "tsx --test \"test/**/*.test.ts\"",
    "test:cli": "npm run build && node dist/cli.js --help && node dist/cli.js --version",
    "start": "node dist/cli.js",
    "typecheck": "tsc --noEmit"
  },
```

Keep the existing `dependencies`, `devDependencies`, and `engines` sections unchanged.

- [ ] **Step 4: Ensure the package-local skills directory exists**

Create `skills/.gitkeep` as an empty file:

```text
```

- [ ] **Step 5: Run package metadata tests to verify they pass**

Run:

```pwsh
npm test -- --test-name-pattern "package exposes|package publish|built CLI smoke"
```

Expected: PASS for the three tests in `test/cli/package.test.ts`.

- [ ] **Step 6: Commit Task 3**

Run:

```pwsh
git add package.json test\cli\package.test.ts skills\.gitkeep
git commit -m "Expose openagent npm bin aliases" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds when Git author identity is configured.

---

### Task 4: Verify built CLI behavior and resource lookup

**Files:**
- Modify: `test/cli/cli.test.ts`

**Interfaces:**
- Consumes:
  - `runCli(argv?: string[], nodeVersion?: string): Promise<number>` from `src/cli.ts`
  - `validateNodeVersion(version?: string): string | undefined` from `src/cli.ts`
- Produces:
  - Test coverage that `--help`, `--version`, and old Node rejection do not enter the runtime.

- [ ] **Step 1: Add tests for non-REPL CLI paths**

Append to `test/cli/cli.test.ts`:

```ts
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
```

Update the import in `test/cli/cli.test.ts` to include `runCli`:

```ts
import { formatHelp, isDirectExecution, runCli, validateNodeVersion } from "../../src/cli.js";
```

- [ ] **Step 2: Run the new tests**

Run:

```pwsh
npm test -- --test-name-pattern "runCli prints|runCli rejects"
```

Expected: PASS for the three `runCli` tests.

- [ ] **Step 3: Build and run smoke checks**

Run:

```pwsh
npm run build
```

Expected: PASS with TypeScript emitting `dist/cli.js` and `dist/index.js`.

Run:

```pwsh
node dist\cli.js --help
```

Expected: output starts with `openagent 0.1.0` and contains `Usage:`.

Run:

```pwsh
node dist\cli.js --version
```

Expected: output is exactly `0.1.0`.

Run:

```pwsh
npm run test:cli
```

Expected: PASS; the script builds and runs help/version smoke checks.

- [ ] **Step 4: Run the full test and typecheck suite**

Run:

```pwsh
npm run typecheck
```

Expected: PASS.

Run:

```pwsh
npm test
```

Expected: PASS for all tests.

- [ ] **Step 5: Commit Task 4**

Run:

```pwsh
git add test\cli\cli.test.ts dist package.json
git commit -m "Verify built openagent CLI behavior" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds when Git author identity is configured. If `dist/` is ignored, omit it from `git add` and commit only tracked source, tests, and package metadata.

---

### Task 5: Document global install and local development flows

**Files:**
- Modify: `README.md:30-43`

**Interfaces:**
- Consumes:
  - npm bin aliases from `package.json`
  - CLI options documented by `formatHelp()`
- Produces:
  - README quick start for `npm install -g open-agent` and `openagent`
  - README local development commands using `npm run dev`

- [ ] **Step 1: Update README quick start**

Replace `README.md:30-43` with:

```md
## Quick start

### Global CLI

```pwsh
npm install -g open-agent
openagent
openagent --cwd C:\some\dir
openagent --yolo
openagent --plan
```

`open-agent` is also available as a compatibility alias for `openagent`.

### Local development

```pwsh
cd Q:\repos\open-agent
npm install
copy .env.example .env   # add your provider credentials

npm run dev                       # REPL, default mode (asks before writes)
npm run dev -- --yolo             # auto-approve all tools
npm run dev -- --plan             # block writes; planning only
npm run dev -- --cron             # start cron scheduler (reads .open-agent/cron.json)
npm run dev -- --autonomous       # start autonomous loop (answers teammate inboxes)
npm run dev -- --cwd C:\some\dir  # change agent working directory
```
```

- [ ] **Step 2: Run documentation-adjacent smoke checks**

Run:

```pwsh
npm run test:cli
```

Expected: PASS.

- [ ] **Step 3: Commit Task 5**

Run:

```pwsh
git add README.md
git commit -m "Document openagent global install flow" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: commit succeeds when Git author identity is configured.

---

### Task 6: Final verification and npm package inspection

**Files:**
- No planned source edits.

**Interfaces:**
- Consumes all previous tasks.
- Produces final confidence that global install packaging contains the right files and commands.

- [ ] **Step 1: Run all verification commands**

Run:

```pwsh
npm run typecheck
```

Expected: PASS.

Run:

```pwsh
npm test
```

Expected: PASS.

Run:

```pwsh
npm run test:cli
```

Expected: PASS.

- [ ] **Step 2: Inspect package contents**

Run:

```pwsh
npm pack --dry-run
```

Expected: output includes `dist/cli.js`, `dist/index.js`, `plugins/example/index.mjs`, `skills/.gitkeep`, `.env.example`, and `README.md`.

- [ ] **Step 3: Inspect final diff**

Run:

```pwsh
git --no-pager status --short
```

Expected: no unrelated files are modified. Only planned files should appear if commits were skipped because Git author identity is not configured.

Run:

```pwsh
git --no-pager diff --stat
```

Expected: changed files match this plan: `src/cli.ts`, `src/index.ts`, `test/cli/cli.test.ts`, `test/cli/package.test.ts`, `package.json`, `README.md`, and `skills/.gitkeep`.

