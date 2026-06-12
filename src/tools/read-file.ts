import { promises as fs } from "node:fs";
import path from "node:path";
import { toolError, type ToolDefinition } from "../types.js";

interface Input {
  path: string;
  start_line?: number;
  end_line?: number;
}

const MAX_BYTES = 200 * 1024;

export const readFileTool: ToolDefinition<Input, string> = {
  name: "read_file",
  description:
    "Read a UTF-8 text file. Optionally pass start_line/end_line (1-indexed, inclusive) to slice.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or cwd-relative path." },
      start_line: { type: "integer", minimum: 1 },
      end_line: { type: "integer", minimum: 1 },
    },
    required: ["path"],
  },
  handler: async (input, ctx) => {
    const abs = path.isAbsolute(input.path) ? input.path : path.join(ctx.cwd, input.path);
    try {
      const stat = await fs.stat(abs);
      if (stat.size > MAX_BYTES) {
        return toolError(`File too large (${stat.size} bytes > ${MAX_BYTES}). Use a line range.`);
      }
      const raw = await fs.readFile(abs, "utf8");
      if (input.start_line || input.end_line) {
        const lines = raw.split(/\r?\n/);
        const start = (input.start_line ?? 1) - 1;
        const end = input.end_line ?? lines.length;
        return lines.slice(start, end).join("\n");
      }
      return raw;
    } catch (err) {
      return toolError(`read_file failed: ${(err as Error).message}`);
    }
  },
};
