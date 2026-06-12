// s07 Permission System: deny -> mode-check -> allow -> ask.
// A small pipeline so we can add modes (yolo, plan, ask) without changing the loop.

import readline from "node:readline/promises";
import type { PermissionDecision, ToolDefinition } from "../types.js";

export type Mode = "default" | "yolo" | "plan";

// Tools that mutate the world. Everything else is read-only.
const WRITE_TOOLS = new Set(["write_file", "run_shell"]);

export function checkPermission(
  tool: ToolDefinition,
  _input: unknown,
  mode: Mode,
): PermissionDecision {
  // 1. deny: nothing hard-denied yet, but this is the place to add it.

  // 2. mode-check
  if (mode === "plan" && WRITE_TOOLS.has(tool.name)) {
    return {
      kind: "deny",
      reason: `plan mode forbids ${tool.name}; describe the change instead.`,
    };
  }
  if (mode === "yolo") {
    return { kind: "allow" };
  }

  // 3. allow read-only tools by default
  if (!WRITE_TOOLS.has(tool.name)) {
    return { kind: "allow" };
  }

  // 4. ask for write tools in default mode
  return { kind: "ask", prompt: `Allow ${tool.name}?` };
}

export async function prompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}
