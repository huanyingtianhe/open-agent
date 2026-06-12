// Built-in hooks shipped with open-agent.
// These illustrate the three hook patterns: observe, block, annotate.

import type { HookManager } from "./manager.js";
import { log } from "../utils/logger.js";

// OBSERVE: log every tool call (debugging aid).
export function logToolCalls(hooks: HookManager): void {
  hooks.register("before_tool_call", "log-tool-call", (p) => {
    log.info(`  > calling ${p.tool_name}`);
  });
}

// BLOCK: prevent run_shell from executing dangerous patterns.
const DANGEROUS = [
  /\brm\s+-rf\s+\//, // rm -rf /
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sf]/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // classic bash fork bomb
];

export function guardDangerousShell(hooks: HookManager): void {
  hooks.register("before_tool_call", "guard-dangerous-shell", (p) => {
    if (p.tool_name !== "run_shell") return;
    const input = p.input as { command?: string };
    const cmd = input?.command ?? "";
    for (const pat of DANGEROUS) {
      if (pat.test(cmd)) {
        return { block: `Refusing dangerous command: ${cmd.slice(0, 60)}` };
      }
    }
  });
}

// ANNOTATE: trim huge tool outputs before they hit the model.
const MAX_RESULT_CHARS = 8_000;
export function truncateToolOutput(hooks: HookManager): void {
  hooks.register("after_tool_call", "truncate-tool-output", (p) => {
    if (typeof p.output === "string" && p.output.length > MAX_RESULT_CHARS) {
      return {
        patch: {
          output:
            p.output.slice(0, MAX_RESULT_CHARS) +
            `\n…[truncated ${p.output.length - MAX_RESULT_CHARS} chars]`,
        },
      };
    }
  });
}

export function installDefaults(hooks: HookManager): void {
  guardDangerousShell(hooks);
  truncateToolOutput(hooks);
  // logToolCalls is opt-in (noisy) -- enable via env var.
  if (process.env.OPEN_AGENT_TRACE) logToolCalls(hooks);
}
