// s01 The Agent Loop -- now with s08 hooks, s11 recovery, s06 compaction.
//
// while (true) {
//   compact if needed (s06)
//   fire before_model_call (s08) -- may patch messages/system
//   call model with retry (s11)
//   fire after_model_call (s08)
//   if no tool_use -> return final text
//   for each tool_use:
//     fire before_tool_call (s08) -- may block or patch input
//     decision = permission.check (s07)
//     if deny/ask-no -> append error as tool_result
//     else -> run handler, then fire after_tool_call (may patch output)
//   append assistant + user(tool_results) to messages
// }
//
// New systems (memory, tasks, background, teams, worktrees, plugins) plug in
// via tools added to the registry. The loop itself doesn't grow.

import { callModel } from "./llm.js";
import { ToolRegistry } from "./tools/registry.js";
import { checkPermission, prompt, type Mode } from "./permissions/pipeline.js";
import { compact, shouldCompact } from "./context/compact.js";
import { HookManager } from "./hooks/manager.js";
import { classify, sleep } from "./recovery/classifier.js";
import { log } from "./utils/logger.js";
import {
  isToolError,
  newSessionState,
  type ApiMessage,
  type SessionState,
  type ToolContext,
  type ToolResultBlockParam,
} from "./types.js";

export interface AgentOptions {
  // s10: accept either a static string or a thunk so the prompt can be
  // rebuilt mid-session (e.g. after memorize / hire_teammate / load_skill
  // changes what the index section should say).
  systemPrompt: string | (() => string | Promise<string>);
  registry: ToolRegistry;
  cwd: string;
  mode: Mode;
  state?: SessionState;
  hooks: ToolContext["hooks"]; // subagent/skill callbacks
  hookManager?: HookManager; // s08
  maxIterations?: number;
  // Cross-turn continuity: prior conversation messages to prepend before the
  // new user turn. The caller is responsible for pruning if they grow too large.
  priorMessages?: ApiMessage[];
}

export interface AgentResult {
  finalText: string;
  messages: ApiMessage[];
  state: SessionState;
  iterations: number;
}

export async function runAgent(
  initialUserMessage: string,
  opts: AgentOptions,
): Promise<AgentResult> {
  const state = opts.state ?? newSessionState();
  // Cross-turn continuity: start from prior history (if any) and append the new user turn.
  const messages: ApiMessage[] = [
    ...(opts.priorMessages ?? []),
    { role: "user", content: initialUserMessage },
  ];
  // ctx.cwd is refreshed each iteration so a mid-loop `cd` takes effect immediately.
  const ctx: ToolContext = { cwd: state.cwd ?? opts.cwd, state, hooks: opts.hooks };
  const maxIter = opts.maxIterations ?? 25;
  const hm = opts.hookManager ?? new HookManager();

  for (let i = 0; i < maxIter; i++) {
    // Refresh effective cwd in case a tool changed it last iteration.
    ctx.cwd = state.cwd ?? opts.cwd;

    if (shouldCompact(state.tokensUsed, messages)) {
      log.info("compacting context...");
      const compacted = await compact(messages);
      messages.splice(0, messages.length, ...compacted);
    }

    // s10: resolve the system prompt fresh so memory/skills/team updates show up.
    const resolvedSystem =
      typeof opts.systemPrompt === "string" ? opts.systemPrompt : await opts.systemPrompt();

    const before = await hm.fire("before_model_call", {
      messages,
      system: resolvedSystem,
    });
    if (before.blocked) {
      messages.push({ role: "user", content: `[hook blocked model call] ${before.reason}` });
      continue;
    }
    const sysForCall = before.payload.system;

    const resp = await callWithRecovery(() =>
      callModel({
        system: sysForCall,
        messages: before.payload.messages,
        tools: opts.registry.all(),
      }),
    );

    state.tokensUsed += resp.usage.input_tokens + resp.usage.output_tokens;

    await hm.fire("after_model_call", {
      response: { content: resp.content, stop_reason: resp.stop_reason },
    });

    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        log.assistant(block.text);
      }
    }

    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      const finalText = resp.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { finalText, messages, state, iterations: i + 1 };
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      const tool = opts.registry.get(block.name);

      if (!tool) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }

      const pre = await hm.fire("before_tool_call", { tool_name: tool.name, input: block.input });
      if (pre.blocked) {
        log.warn(`hook blocked ${tool.name}: ${pre.reason}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Blocked by hook: ${pre.reason}`,
          is_error: true,
        });
        continue;
      }
      const finalInput = pre.payload.input;

      const decision = checkPermission(tool, finalInput, opts.mode);
      if (decision.kind === "deny") {
        log.warn(`denied ${tool.name}: ${decision.reason}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Denied by policy: ${decision.reason}`,
          is_error: true,
        });
        continue;
      }
      if (decision.kind === "ask") {
        log.info(`tool=${tool.name} input=${JSON.stringify(finalInput)}`);
        const ok = await prompt(decision.prompt);
        if (!ok) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Denied by user.",
            is_error: true,
          });
          continue;
        }
      }

      try {
        const raw = await tool.handler(finalInput as never, ctx);
        const isErr = isToolError(raw);
        const initial = isErr
          ? (raw as { message: string }).message
          : typeof raw === "string"
            ? raw
            : JSON.stringify(raw, null, 2);

        const post = await hm.fire("after_tool_call", {
          tool_name: tool.name,
          output: initial,
          is_error: isErr,
        });
        const finalOutput = post.blocked
          ? `Blocked by hook: ${post.reason}`
          : (post.payload.output as string);

        if (isErr) log.tool(tool.name, `error: ${finalOutput}`);
        else log.tool(tool.name, finalOutput);

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: finalOutput,
          is_error: isErr,
        });
      } catch (err) {
        const msg = (err as Error).message;
        await hm.fire("on_error", { phase: `tool:${tool.name}`, error: err as Error });
        log.tool(tool.name, `exception: ${msg}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Exception: ${msg}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Agent exceeded ${maxIter} iterations without finishing.`);
}

async function callWithRecovery<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const action = classify(err, attempt);
      if (action.kind === "escalate") throw err;
      if (action.kind === "replan") throw err;
      log.warn(`model call failed (${(err as Error).message}); retrying in ${action.delay_ms}ms`);
      await sleep(action.delay_ms);
      attempt++;
      if (attempt >= action.max_attempts) throw err;
    }
  }
}
