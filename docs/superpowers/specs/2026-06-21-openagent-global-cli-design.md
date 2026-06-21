# OpenAgent global CLI design

## Goal

Make this project install and start like a polished Claude Code style CLI: users install it globally with `npm install -g open-agent`, then run `openagent` from any project directory.

The primary command will be `openagent`. The existing hyphenated command, `open-agent`, will remain as a compatibility alias.

## Architecture

The current agent entrypoint in `src/index.ts` will remain responsible for wiring the agent runtime: tools, skills, memory, hooks, MCP, plugins, cron, autonomy, and the REPL.

A new thin CLI bootstrap entrypoint will be added, for example `src/cli.ts`. It will handle package-facing startup concerns before delegating to the existing runtime:

- `--help`
- `--version`
- Node.js version validation
- argument forwarding
- clear startup errors for CLI-specific failures

`package.json` will expose both commands through `bin`:

- `openagent`
- `open-agent`

Both commands will point to the built CLI file in `dist/`.

## Installation and startup behavior

The target user flow is:

```sh
npm install -g open-agent
openagent
```

Users can still run in another working directory with:

```sh
openagent --cwd C:\path\to\project
```

The agent will continue to read `.env` from the user's current working directory, so credentials and project-local configuration stay with the project where the user starts the agent.

## Packaged resources

The published package must include the runtime files needed after TypeScript compilation:

- `dist/`
- `skills/`
- `plugins/`
- `.env.example`
- `README.md`

Runtime lookup for built-in skills and plugins should prefer package-local resource directories, while still allowing project-local directories to participate where the existing behavior supports it.

## Error handling

The CLI bootstrap will check for Node.js `>=20` before starting the runtime. If the version is too old, it will print a concise message explaining the required version and exit non-zero.

Missing LLM credentials will continue through the existing provider/runtime error paths rather than being treated as a CLI bootstrap failure. Documentation will explain that users can configure credentials through `.env` or use `/login` for Copilot auth.

## Testing

Add CLI-oriented smoke coverage after build:

- `openagent --version` prints the package version.
- `openagent --help` prints usage without starting the REPL.
- `package.json` maps both `openagent` and `open-agent` to the built CLI entrypoint.
- Built resource lookup does not depend on the TypeScript source tree.

Existing tests and type checks should continue to pass.

## Non-goals

This design does not change the agent loop, tool behavior, model providers, permission model, or durable state layout.

