# open-agent

A readable, end-to-end TypeScript implementation of a Claude-Code-style agent.

## Code map

| Area | What it covers | Where it lives |
|---|---|---|
| Agent loop | Model calls, message history, and tool execution | `src/agent.ts` |
| Tool registry | Tool schemas, dispatch, and built-in tools | `src/tools/registry.ts` + `src/tools/*.ts` |
| Todos | In-session task tracking | `src/tools/todo-write.ts` |
| Subagents | Delegated agent runs | `src/tools/subagent.ts`, `runSubagent` in `src/index.ts` |
| Skills | Markdown skill discovery and invocation | `src/skills/loader.ts`, `src/tools/skill.ts`, `skills/*/SKILL.md` |
| Context compaction | History summarization before model calls | `src/context/compact.ts` |
| Permissions | Approval policy before tool execution | `src/permissions/pipeline.ts` |
| Hooks | Lifecycle hooks around model and tool calls | `src/hooks/manager.ts` + `src/hooks/builtin.ts` |
| Memory | Durable notes and AGENTS.md auto-loading | `src/memory/store.ts` + `memorize/recall/forget` tools |
| Prompt builder | Sectioned system prompt assembly | `src/prompt/builder.ts` |
| Error recovery | Retry classification for transient failures | `src/recovery/classifier.ts` |
| Tasks | Durable task graph operations | `src/tasks/graph.ts` + `task_create/update/list` tools |
| Background jobs | Long-running work outside the foreground loop | `src/background/runner.ts` + `background_start/status/result` tools |
| Cron | Scheduled prompts from `.open-agent/cron.json` | `src/cron/scheduler.ts` |
| Teams | Teammate records and inbox state | `src/teams/store.ts` + `team_hire/list` tools |
| Team protocol | Request/response envelopes between teammates | `src/teams/store.ts` + `team_send/await_response` |
| Autonomy | Idle scanning, claiming, resuming, and emitting work | `src/autonomy/loop.ts` |
| Worktrees | Isolated git worktree management | `src/worktree/manager.ts` + `worktree_create/remove/list` tools |
| MCP | Configured MCP servers and namespaced MCP tools | `src/mcp/manager.ts`, `src/mcp/config.ts`, `src/mcp/tools.ts` |
| Plugins | External tool loading and plugin examples | `src/plugins/loader.ts` + `plugins/example/index.mjs` |

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

## LLM providers

Pick a backend with the `LLM_PROVIDER` env var. The agent loop, tools, hooks,
and skills are identical across providers — only `src/llm.ts` changes.

| Provider | `LLM_PROVIDER` | Required env vars | Notes |
|---|---|---|---|
| Anthropic (default) | `anthropic` | `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) | Uses official SDK. |
| GitHub Copilot | `copilot` | One of: `GITHUB_COPILOT_TOKEN`, `GITHUB_TOKEN`, or `gh auth token` available on PATH. Optional `COPILOT_MODEL`. | Requires an active Copilot subscription. Uses the undocumented Copilot chat endpoint; may break if upstream changes. |
| Azure OpenAI | `azure-openai` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, plus either `AZURE_OPENAI_API_KEY` or `AZURE_OPENAI_BEARER_TOKEN`. Optional `AZURE_OPENAI_API_VERSION` (default `2024-10-21`). | Deployment name lives in the URL, so the request `model` field is ignored. |

**Adding a new provider** is a 3-step change isolated to `src/llm/`:
1. Implement the `Provider` interface in `src/llm/<name>.ts`.
2. Add a case to `pickProvider()` in `src/llm.ts`.
3. Document its env vars in `.env.example`.

For any OpenAI-compatible API (OpenRouter, Ollama, Mistral, Together…) you can
reuse `src/llm/openai-compat.ts` and write a 30-line provider class.

REPL commands:

| Command | Shows |
|---|---|
| `/exit` | quit |
| `/todos` | in-session todo list (s03) |
| `/tasks` | durable task graph (s12) |
| `/memory` | remembered notes index (s09) |
| `/team` | hired teammates (s15) |
| `/background` | background jobs (s13) |
| `/cron` | scheduled jobs (s14) |
| `/hooks` | registered hooks (s08) |
| `/plugins` | loaded plugins (s19) |
| `/mcp` | configured MCP servers and tool counts (s19) |

## Persistence layout

All durable state lives under `<cwd>/.open-agent/`:

```
.open-agent/
├── memory.json        # s09
├── tasks.json         # s12
├── team.json          # s15 (teammates + inbox)
├── cron.json          # s14 (you edit this manually)
├── mcp.json           # s19 (optional MCP server config)
└── worktrees/         # s18 (created by git worktree add)
```

`AGENTS.md` files anywhere from `cwd` up to filesystem root are auto-collected
into the system prompt.

## Architecture in one paragraph

The whole agent is one `while` loop in `src/agent.ts`. Each iteration: maybe
compact the history (s06), fire `before_model_call` hooks (s08), call the model
with retry-on-transient (s11), fire `after_model_call`, then for every
`tool_use` block run it through the **hook → permission → handler → hook**
pipeline. Tool results go back as a single `user` message of `tool_result`
blocks. Everything else — skills, memory, durable tasks, background jobs,
teammates, worktrees, plugins — is just more tools added to the registry. The
loop never grew past ~200 lines.

## Adding things

| To add a... | Do this |
|---|---|
| Tool | Create `src/tools/X.ts` exporting a `ToolDefinition`; register it in `src/index.ts`. |
| Skill | Create `skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`). |
| Hook | Call `hookManager.register("<event>", "<name>", fn)` in `src/index.ts`. |
| Plugin | Create `plugins/<name>/index.mjs` exporting `{ name, tools[] }`. |
| Cron job | Edit `.open-agent/cron.json`: `[{ "id", "interval_seconds", "prompt" }]`. |
| Teammate | Use the `team_hire` tool inside the REPL (persists to `team.json`). |

## MCP servers

MCP servers are configured in `.open-agent/mcp.json`. At startup, open-agent
connects to each server, lists its tools, and registers them as normal agent
tools using the name format `mcp__<server>__<tool>`.

```json
{
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "local-sse": {
      "transport": "sse",
      "url": "http://localhost:3000/sse"
    },
    "remote-http": {
      "transport": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
```

If a server fails to connect, the agent logs a warning and continues with the
other tools. Use `/mcp` in the REPL to see connected servers and tool counts.

## Examples

```text
you> remember that this repo's main branch is `trunk` not `main`
agent> [memorize key=repo-main-branch ...]

you> hire a teammate named "doc-writer" whose role is to draft markdown docs;
     system prompt: "You are a concise technical writer. Use bullets."

you> /team
doc-writer -- to draft markdown docs

# in another terminal, run autonomous mode so doc-writer answers messages:
npm run dev -- --autonomous

# then back in the first REPL:
you> send doc-writer a request asking for a 5-bullet description of this repo
agent> [team_send id=ab12cd34 to=doc-writer ...]
agent> [team_await_response request_id=ab12cd34 ...]
agent> Here is what doc-writer wrote: ...
```

## Intentional non-goals

- **No production polish.** Error messages, retries, and concurrency safety
  are minimum-viable. The point is to be read.
- **No MCP resources/prompts yet.** MCP tool calls are supported, but resource
  browsing and prompt templates are not wired into the agent loop yet.
- **No multi-process isolation.** Teammates / background / autonomy all share
  one Node process. Add `worker_threads` or `child_process.fork` when needed.
- **No conversational continuity across turns.** Each `you>` starts fresh.
  Durable state (memory, tasks, team inbox) is what survives. Easy to extend
  by carrying `result.messages` forward — see TODO in `src/index.ts`.
