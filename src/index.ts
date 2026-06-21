#!/usr/bin/env node
// CLI entry: wires every subsystem (s01-s19) into one runnable REPL.

import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { promises as fs } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runAgent } from "./agent.js";
import { providerName } from "./llm.js";
import { ToolRegistry } from "./tools/registry.js";

// s02 base tools
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { runShellTool } from "./tools/run-shell.js";
import { cdTool } from "./tools/cd.js";
// s03
import { todoWriteTool } from "./tools/todo-write.js";
// s04
import { subagentTool } from "./tools/subagent.js";
// s05
import { SkillIndex } from "./skills/loader.js";
import { makeSkillTool } from "./tools/skill.js";
// s08
import { HookManager } from "./hooks/manager.js";
import { installDefaults as installDefaultHooks } from "./hooks/builtin.js";
// s09
import { MemoryStore, loadAgentsMd } from "./memory/store.js";
import { extractMemoriesAfterTurn } from "./memory/extract.js";
import { makeMemorizeTool, makeRecallTool, makeForgetTool } from "./tools/memory.js";
// s10
import {
  buildSystemPrompt,
  defaultIdentity,
  defaultRules,
  environmentSection,
  modeSection,
} from "./prompt/builder.js";
// s12
import { TaskGraph } from "./tasks/graph.js";
import { makeTaskCreateTool, makeTaskListTool, makeTaskUpdateTool } from "./tools/task.js";
// s13
import { BackgroundRunner } from "./background/runner.js";
import {
  makeBackgroundResultTool,
  makeBackgroundStartTool,
  makeBackgroundStatusTool,
} from "./tools/background.js";
// s14
import { CronScheduler } from "./cron/scheduler.js";
// s15 / s16
import { TeamStore } from "./teams/store.js";
import {
  makeTeamAwaitResponseTool,
  makeTeamHireTool,
  makeTeamListTool,
  makeTeamSendTool,
} from "./tools/team.js";
// s17
import { AutonomousLoop } from "./autonomy/loop.js";
// s18
import { WorktreeManager } from "./worktree/manager.js";
import {
  makeWorktreeCreateTool,
  makeWorktreeListTool,
  makeWorktreeRemoveTool,
} from "./tools/worktree.js";
// s19
import { PluginLoader } from "./plugins/loader.js";
import { McpManager } from "./mcp/manager.js";
// Copilot auth (for /login, /logout commands)
import {
  clearCachedToken as clearCopilotCachedToken,
  deviceFlowLogin as copilotDeviceFlowLogin,
  saveCachedToken as saveCopilotCachedToken,
} from "./llm/copilot-auth.js";

import { newSessionState, type ToolDefinition } from "./types.js";
import type { Mode } from "./permissions/pipeline.js";
import { log } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- arg parsing --------------------------------------------------------

interface Args {
  mode: Mode;
  cwd: string;
  autonomous: boolean;
  cron: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "default", cwd: process.cwd(), autonomous: false, cron: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yolo") args.mode = "yolo";
    else if (a === "--plan") args.mode = "plan";
    else if (a === "--autonomous") args.autonomous = true;
    else if (a === "--cron") args.cron = true;
    else if (a === "--cwd") args.cwd = path.resolve(argv[++i]);
  }
  return args;
}

// ---- env loader (no dotenv dep) -----------------------------------------

async function loadDotenv(): Promise<void> {
  const envPath = path.join(process.cwd(), ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* .env is optional */
  }
}

function isDirectExecution(importMetaUrl: string, argvPath: string | undefined = process.argv[1]): boolean {
  if (!argvPath) return false;
  return pathToFileURL(path.resolve(argvPath)).href === importMetaUrl;
}

// ---- locate skills & plugins directories --------------------------------

async function locateDir(candidates: string[]): Promise<string> {
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      /* keep looking */
    }
  }
  return candidates[0];
}

// ---- main ---------------------------------------------------------------

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await loadDotenv();
  const args = parseArgs(argv);

  // --- locate static asset dirs (skills, plugins) ---
  const skillsDir = await locateDir([
    path.resolve(__dirname, "..", "skills"),
    path.resolve(__dirname, "..", "..", "skills"),
    path.join(args.cwd, "skills"),
  ]);
  const pluginsDir = await locateDir([
    path.resolve(__dirname, "..", "plugins"),
    path.resolve(__dirname, "..", "..", "plugins"),
    path.join(args.cwd, "plugins"),
  ]);

  // --- s05 skills ---
  const skills = new SkillIndex(skillsDir);
  await skills.load();

  // --- s08 hooks ---
  const hookManager = new HookManager();
  installDefaultHooks(hookManager);

  // --- s09 memory ---
  const memory = new MemoryStore(args.cwd);
  await memory.load();
  // AGENTS.md is re-walked inside getSystemPrompt() so a file edit between
  // turns shows up without restart.

  // --- s12 tasks ---
  const tasks = new TaskGraph(args.cwd);
  await tasks.load();

  // --- s15 teams ---
  const team = new TeamStore(args.cwd);
  await team.load();

  // --- s18 worktrees ---
  const worktrees = new WorktreeManager(args.cwd);

  // --- s19 plugins ---
  const pluginLoader = new PluginLoader(pluginsDir);
  const loadedPlugins = await pluginLoader.loadAll();

  // --- s19 MCP servers ---
  const mcp = new McpManager(args.cwd);
  await mcp.load();

  // --- registry: register every tool ---
  const registry = new ToolRegistry();

  // s02 / s03 / s04 / s05
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(runShellTool);
  registry.register(cdTool);
  registry.register(todoWriteTool);
  registry.register(subagentTool);
  registry.register(makeSkillTool(skills));

  // s09
  registry.register(makeMemorizeTool(memory));
  registry.register(makeRecallTool(memory));
  registry.register(makeForgetTool(memory));

  // s12
  registry.register(makeTaskCreateTool(tasks));
  registry.register(makeTaskUpdateTool(tasks));
  registry.register(makeTaskListTool(tasks));

  // s13 -- runner needs to call back into runAgent, so define after that exists
  // (deferred below)

  // s15 / s16
  registry.register(makeTeamListTool(team));
  registry.register(makeTeamHireTool(team));
  registry.register(makeTeamSendTool(team));
  registry.register(makeTeamAwaitResponseTool(team));

  // s18
  registry.register(makeWorktreeCreateTool(worktrees));
  registry.register(makeWorktreeRemoveTool(worktrees));
  registry.register(makeWorktreeListTool(worktrees));

  // s19 plugins -- last so user-named tools can be overridden if needed
  for (const p of loadedPlugins) {
    for (const t of p.manifest.tools) {
      try {
        registry.register(t);
      } catch (err) {
        log.warn(`plugin ${p.manifest.name}: ${(err as Error).message}`);
      }
    }
  }

  // MCP tools use their own namespace (`mcp__server__tool`) to avoid conflicts.
  for (const t of mcp.tools()) {
    try {
      registry.register(t);
    } catch (err) {
      log.warn(`mcp tool ${t.name}: ${(err as Error).message}`);
    }
  }

  // --- s10 build system prompt as a sectioned pipeline ---
  // Closure so memory/AGENTS.md/skills/cwd changes show up next iteration.
  // Reads the live state on every call: re-walking AGENTS.md and re-summarizing
  // memory means new memorize/hire/skill activity is visible to the model
  // without a REPL restart.
  const state = newSessionState();
  const getSystemPrompt = async (): Promise<string> => {
    const effectiveCwd = state.cwd ?? args.cwd;
    const freshAgentsMd = await loadAgentsMd(effectiveCwd);
    return buildSystemPrompt({
      identity: defaultIdentity(),
      environment: environmentSection(effectiveCwd, `${os.type()} ${os.release()}`),
      memory_index: memory.summary(),
      agents_md: freshAgentsMd || undefined,
      skills: skills.summary(),
      mode: modeSection(args.mode),
      custom: defaultRules(),
    });
  };

  // --- s04 subagent hook ---
  const runSubagent = async (subPrompt: string, allowed?: string[]): Promise<string> => {
    const subRegistry = new ToolRegistry();
    const tools = allowed
      ? registry.subset(allowed)
      : [readFileTool as ToolDefinition, runShellTool as ToolDefinition];
    for (const t of tools) subRegistry.register(t);
    const sub = await runAgent(subPrompt, {
      systemPrompt: "You are a focused subagent. Return a single concise final answer.",
      registry: subRegistry,
      cwd: state.cwd ?? args.cwd,
      mode: args.mode,
      hookManager,
      hooks: {
        runSubagent: async () => "Nested subagents disabled.",
        loadSkill: async () => "Skills disabled in subagents.",
      },
      maxIterations: 10,
    });
    return sub.finalText;
  };

  const skillHook = async (name: string) => skills.loadBody(name);

  // --- s13 background runner (now that runAgent + registry exist) ---
  const background = new BackgroundRunner(async (prompt: string) => {
    const res = await runAgent(prompt, {
      systemPrompt: getSystemPrompt,
      registry,
      cwd: state.cwd ?? args.cwd,
      mode: args.mode,
      hookManager,
      hooks: { runSubagent, loadSkill: skillHook },
      maxIterations: 30,
    });
    return res.finalText;
  });
  registry.register(makeBackgroundStartTool(background));
  registry.register(makeBackgroundStatusTool(background));
  registry.register(makeBackgroundResultTool(background));

  // --- s14 cron (optional, enabled with --cron) ---
  const cron = new CronScheduler(args.cwd, background);
  await cron.load();
  if (args.cron) {
    cron.start();
    log.info(`cron: ${cron.list().length} job(s) scheduled`);
  }

  // --- s17 autonomous loop (optional, enabled with --autonomous) ---
  const responder = async (teammate: { system_prompt: string }, prompt: string) => {
    // Each teammate runs its own session with its own system prompt and tools.
    const res = await runAgent(prompt, {
      systemPrompt: teammate.system_prompt,
      registry,
      cwd: state.cwd ?? args.cwd,
      mode: args.mode,
      hookManager,
      hooks: { runSubagent, loadSkill: skillHook },
      maxIterations: 20,
    });
    return res.finalText;
  };
  const autonomy = new AutonomousLoop(team, responder);
  if (args.autonomous) {
    autonomy.start();
    log.info(`autonomy: watching ${team.listTeammates().length} teammate(s)`);
  }

  // --- banner ---
  log.info(
    `open-agent ready. provider=${providerName()} mode=${args.mode} cwd=${args.cwd} ` +
      `skills=${skills.list().length} tools=${registry.all().length} ` +
      `plugins=${loadedPlugins.length} tasks=${tasks.list().length} ` +
      `mcp_tools=${mcp.tools().length} teammates=${team.listTeammates().length}`,
  );
  log.info(
    "Commands: /exit /todos /tasks /memory /team /background /cron /hooks /plugins /mcp /reset /login /logout",
  );

  // --- REPL ---
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Cross-turn conversation history. Each completed runAgent appends its turn
  // here and we feed the full thing back as priorMessages on the next call so
  // the model can reference prior context.
  let conversation: import("./types.js").ApiMessage[] = [];
  // Keep the carried history bounded; the s06 compactor handles per-call growth,
  // but we cap the REPL-carried tail so a long session doesn't accumulate forever.
  const MAX_CARRIED_MESSAGES = 40;

  try {
    while (true) {
      const userInput = (await rl.question("\nyou> ")).trim();
      if (!userInput) continue;
      if (userInput === "/exit" || userInput === "/quit") break;

      if (userInput === "/reset") {
        conversation = [];
        log.info("conversation history cleared.");
        continue;
      }
      if (userInput === "/login") {
        try {
          const token = await copilotDeviceFlowLogin();
          await saveCopilotCachedToken(token);
          log.info("Copilot login complete. Token cached to ~/.open-agent/copilot-token.json");
        } catch (e) {
          log.error(`login failed: ${(e as Error).message}`);
        }
        continue;
      }
      if (userInput === "/logout") {
        await clearCopilotCachedToken();
        log.info("Cleared cached Copilot token from ~/.open-agent/copilot-token.json");
        continue;
      }
      if (userInput === "/todos") {
        log.info(JSON.stringify(state.todos, null, 2));
        continue;
      }
      if (userInput === "/tasks") {
        log.info(tasks.list().map((t) => `${t.id} [${t.status}] ${t.title}`).join("\n") || "(none)");
        continue;
      }
      if (userInput === "/memory") {
        log.info(memory.summary());
        continue;
      }
      if (userInput === "/team") {
        log.info(team.listTeammates().map((t) => `${t.name} -- ${t.role}`).join("\n") || "(none)");
        continue;
      }
      if (userInput === "/background") {
        const jobs = background.list();
        log.info(jobs.map((j) => `${j.id} ${j.status} ${j.prompt.slice(0, 60)}`).join("\n") || "(none)");
        continue;
      }
      if (userInput === "/cron") {
        log.info(cron.list().map((c) => `${c.id} every ${c.interval_seconds}s`).join("\n") || "(none)");
        continue;
      }
      if (userInput === "/hooks") {
        log.info(hookManager.list().map((h) => `${h.event}  ${h.name}`).join("\n") || "(none)");
        continue;
      }
      if (userInput === "/plugins") {
        log.info(
          loadedPlugins
            .map((p) => `${p.manifest.name} (${p.manifest.tools.length} tools)`)
            .join("\n") || "(none)",
        );
        continue;
      }
      if (userInput === "/mcp") {
        log.info(mcp.summary());
        continue;
      }

      const result = await runAgent(userInput, {
        systemPrompt: getSystemPrompt,
        registry,
        cwd: state.cwd ?? args.cwd,
        mode: args.mode,
        state,
        hookManager,
        hooks: { runSubagent, loadSkill: skillHook },
        priorMessages: conversation,
      });

      const extracted = await extractMemoriesAfterTurn(memory, result.messages);
      if (extracted > 0) log.info(`memory: extracted ${extracted} new note(s)`);

      // Carry the full message tail forward, capped to keep things bounded.
      conversation = result.messages.slice(-MAX_CARRIED_MESSAGES);
    }
  } finally {
    rl.close();
    autonomy.stop();
    cron.stop();
    await mcp.close();
  }
}

if (isDirectExecution(import.meta.url)) {
  main().catch((err) => {
    log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
