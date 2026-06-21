# Agent execution metrics design

## Goal

Expose machine-readable execution metrics from the running agent so dashboards and automation can show agent activity, cost-related token usage, and tool execution reliability.

The first version focuses on Prometheus-compatible scraping from the local CLI process.

## Architecture

Add focused metrics modules under `src/metrics/`:

- `registry.ts` stores cumulative in-memory counters and derived rates for the current process.
- `prometheus.ts` renders registry snapshots as Prometheus text exposition.
- `server.ts` starts an optional HTTP server that serves `GET /metrics`.

`runAgent()` will accept an optional metrics recorder through `AgentOptions`. The agent loop will record execution boundaries and counts where the data already exists:

- run start and completion status
- iteration count
- model call count and duration
- input/output token totals
- tool call count
- tool success/error status

This keeps metrics close to the source of truth without changing provider behavior, tool behavior, permission behavior, or durable state.

## Endpoint and configuration

Metrics are disabled by default.

The CLI can enable metrics with either:

```pwsh
openagent --metrics-port 9464
```

or:

```pwsh
$env:OPEN_AGENT_METRICS_PORT = "9464"
openagent
```

The server binds to `127.0.0.1` by default. Advanced users may override the host with `OPEN_AGENT_METRICS_HOST`.

`GET /metrics` returns Prometheus text format with cumulative metrics since the process started. Other paths return `404`.

## Metrics

The v1 metric set is:

- `open_agent_runs_total{status}` — completed agent runs by status, including `success` and `error`.
- `open_agent_iterations_total` — total agent loop iterations.
- `open_agent_model_calls_total` — total model calls attempted by the agent loop.
- `open_agent_model_call_duration_seconds_sum` — cumulative model call duration in seconds.
- `open_agent_model_call_duration_seconds_count` — model call duration sample count.
- `open_agent_tokens_total{kind}` — token totals, with `kind="input"` and `kind="output"`.
- `open_agent_tool_calls_total{tool,status}` — tool executions by tool name and status, including `success` and `error`.
- `open_agent_tool_success_rate{tool}` — derived per-tool success ratio from `0` to `1`.

Unknown tools, policy denials, user denials, hook blocks, tool error results, and thrown tool exceptions count as tool errors for success-rate purposes.

## Error handling

Metrics collection must never break agent execution. Recorder failures should be contained inside the metrics layer and not alter agent responses, tool outputs, or permission decisions.

If the metrics server cannot bind its configured port, CLI startup should fail with a clear error. A configured metrics endpoint that cannot start is an explicit user request and should not silently disappear.

## Testing

Tests will cover:

- Registry recording and derived tool success rates.
- Prometheus text rendering and label escaping.
- HTTP server responses for `/metrics` and unknown paths.
- CLI arg/env parsing for metrics enablement.
- `runAgent()` integration using fake model/tool paths or dependency seams so model calls, tokens, tool successes, and tool errors are recorded without calling a real provider.

## Non-goals

This design does not add a remote OpenTelemetry exporter, persistent metrics history, authentication for the local endpoint, per-conversation dashboards, or metrics across multiple processes.

