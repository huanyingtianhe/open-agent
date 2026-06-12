import { toolError, type ToolDefinition } from "../types.js";
import type { BackgroundRunner } from "../background/runner.js";

export function makeBackgroundStartTool(runner: BackgroundRunner): ToolDefinition {
  return {
    name: "background_start",
    description:
      "Start a self-contained agent run in the background and return a job id. " +
      "Use for long-running work you don't want to block the foreground session on " +
      "(e.g. 'analyze every file in src/ and write a summary report').",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Self-contained task description." },
      },
      required: ["prompt"],
    },
    handler: async (input: any) => {
      const job = runner.start(input.prompt);
      return `Background job ${job.id} started.`;
    },
  };
}

export function makeBackgroundStatusTool(runner: BackgroundRunner): ToolDefinition {
  return {
    name: "background_status",
    description: "Get the status of a background job (or list all if no id given).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
    },
    handler: async (input: any) => {
      if (input?.id) {
        const j = runner.get(input.id);
        if (!j) return toolError(`No such job: ${input.id}`);
        return JSON.stringify(j, null, 2);
      }
      const jobs = runner.list();
      if (jobs.length === 0) return "(no background jobs)";
      return jobs.map((j) => `${j.id}  ${j.status.padEnd(10)} ${j.prompt.slice(0, 60)}`).join("\n");
    },
  };
}

export function makeBackgroundResultTool(runner: BackgroundRunner): ToolDefinition {
  return {
    name: "background_result",
    description:
      "Wait for a background job to finish (up to timeout_ms, default 60000) and " +
      "return its final result or error.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        timeout_ms: { type: "integer", minimum: 100, default: 60000 },
      },
      required: ["id"],
    },
    handler: async (input: any) => {
      try {
        const job = await runner.await(input.id, input.timeout_ms ?? 60_000);
        if (job.status === "failed") return toolError(job.error ?? "job failed");
        return job.result ?? "(no result)";
      } catch (e) {
        return toolError((e as Error).message);
      }
    },
  };
}
