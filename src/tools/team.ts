// Tools that expose the team store and protocol (s15 + s16) to the model.

import { toolError, type ToolDefinition } from "../types.js";
import type { TeamStore } from "../teams/store.js";

const SELF = "user"; // the foreground REPL agent's identity in the team

export function makeTeamListTool(store: TeamStore): ToolDefinition {
  return {
    name: "team_list",
    description: "List all persisted teammates (name, role).",
    input_schema: { type: "object", properties: {} },
    handler: async () => {
      const ts = store.listTeammates();
      if (ts.length === 0) return "(no teammates)";
      return ts.map((t) => `${t.name}  -- ${t.role}`).join("\n");
    },
  };
}

export function makeTeamHireTool(store: TeamStore): ToolDefinition {
  return {
    name: "team_hire",
    description:
      "Create a new teammate identity with a name, short role description, and a " +
      "system prompt that defines their behaviour. Teammates persist across sessions.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        system_prompt: { type: "string" },
      },
      required: ["name", "role", "system_prompt"],
    },
    handler: async (input: any) => {
      try {
        const t = await store.addTeammate(input.name, input.role, input.system_prompt);
        return `Hired ${t.name} (${t.role}).`;
      } catch (e) {
        return toolError((e as Error).message);
      }
    },
  };
}

export function makeTeamSendTool(store: TeamStore): ToolDefinition {
  return {
    name: "team_send",
    description:
      "Send a protocol message to a teammate (or '*' to broadcast). Returns the " +
      "message id; use team_await_response with that id to get the reply.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Teammate name, or '*' for broadcast." },
        subject: { type: "string" },
        body: { type: "string" },
        type: { type: "string", enum: ["request", "broadcast"], default: "request" },
      },
      required: ["to", "subject", "body"],
    },
    handler: async (input: any) => {
      if (input.to !== "*" && !store.getTeammate(input.to)) {
        return toolError(`Unknown teammate: ${input.to}. Use team_list to see who's hired.`);
      }
      const msg = await store.send({
        from: SELF,
        to: input.to,
        subject: input.subject,
        body: input.body,
        type: input.type ?? "request",
      });
      return `Sent ${msg.id} -> ${msg.to}`;
    },
  };
}

export function makeTeamAwaitResponseTool(store: TeamStore): ToolDefinition {
  return {
    name: "team_await_response",
    description:
      "Poll for a response to a previously-sent request. Returns the response body " +
      "or a 'no response yet' marker. The autonomous loop (if running) will answer " +
      "requests addressed to teammates.",
    input_schema: {
      type: "object",
      properties: {
        request_id: { type: "string" },
        timeout_ms: { type: "integer", minimum: 100, default: 30000 },
        poll_ms: { type: "integer", minimum: 100, default: 1000 },
      },
      required: ["request_id"],
    },
    handler: async (input: any) => {
      const deadline = Date.now() + (input.timeout_ms ?? 30_000);
      const poll = input.poll_ms ?? 1000;
      while (Date.now() < deadline) {
        const r = store.responseTo(input.request_id);
        if (r) return `[from ${r.from}] ${r.body}`;
        await new Promise((res) => setTimeout(res, poll));
      }
      return "(no response yet)";
    },
  };
}
