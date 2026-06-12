// s05 Skill: load the full body of a skill by name.
// The system prompt advertises name+description for all skills (cheap discovery).
// The model calls this tool to pull the deep instructions only when needed.

import { toolError, type ToolDefinition } from "../types.js";
import type { SkillIndex } from "../skills/loader.js";

interface Input {
  name: string;
}

export function makeSkillTool(index: SkillIndex): ToolDefinition<Input, string> {
  return {
    name: "skill",
    description:
      "Load the full instructions for a skill by name. Use this when a skill listed in " +
      "the system prompt looks relevant to the current task.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name from the advertised list." },
      },
      required: ["name"],
    },
    handler: async (input) => {
      const entry = index.get(input.name);
      if (!entry) return toolError(`Unknown skill: ${input.name}`);
      try {
        return await index.loadBody(input.name);
      } catch (err) {
        return toolError(`Failed to load skill ${input.name}: ${(err as Error).message}`);
      }
    },
  };
}
