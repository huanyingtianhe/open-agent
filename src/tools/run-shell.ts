import { exec } from "node:child_process";
import { promisify } from "node:util";
import { toolError, type ToolDefinition } from "../types.js";

const execAsync = promisify(exec);

interface Input {
  command: string;
  timeout_ms?: number;
}

interface Output {
  stdout: string;
  stderr: string;
  exit_code: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export const runShellTool: ToolDefinition<Input, Output> = {
  name: "run_shell",
  description:
    "Run a shell command in the agent cwd. Returns stdout, stderr, and exit_code. " +
    "Use for tests, builds, git, package managers. Avoid long-running servers.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_ms: { type: "integer", minimum: 1000, default: DEFAULT_TIMEOUT_MS },
    },
    required: ["command"],
  },
  handler: async (input, ctx) => {
    try {
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: ctx.cwd,
        timeout: input.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
      });
      return { stdout, stderr, exit_code: 0 };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      if (typeof e.code === "number") {
        return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exit_code: e.code };
      }
      return toolError(`run_shell failed: ${e.message}`);
    }
  },
};
