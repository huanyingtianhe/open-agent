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

test("package builds before packing so bin targets exist in published tarballs", async () => {
  const pkg = await readPackageJson();

  assert.equal(pkg.scripts?.prepack, "npm run build");
});
