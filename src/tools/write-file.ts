import { promises as fs } from "node:fs";
import path from "node:path";
import { toolError, type ToolDefinition } from "../types.js";

interface Input {
  path: string;
  content: string;
  create_dirs?: boolean;
}

export const writeFileTool: ToolDefinition<Input, string> = {
  name: "write_file",
  description:
    "Write content to a file (overwrites existing). Set create_dirs=true to mkdir -p the parent.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      create_dirs: { type: "boolean", default: false },
    },
    required: ["path", "content"],
  },
  handler: async (input, ctx) => {
    const abs = path.isAbsolute(input.path) ? input.path : path.join(ctx.cwd, input.path);
    try {
      if (input.create_dirs) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
      }
      await fs.writeFile(abs, input.content, "utf8");
      return `Wrote ${input.content.length} chars to ${abs}`;
    } catch (err) {
      return toolError(`write_file failed: ${(err as Error).message}`);
    }
  },
};
