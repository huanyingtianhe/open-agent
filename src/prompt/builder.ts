// s10 System Prompt as a constructed input pipeline.
//
// The model never sees one big static string; it sees the concatenation of
// labelled sections that each part of the system contributes:
//
//   identity -> environment -> memory_index -> agents_md -> skills -> mode -> custom
//
// Sections may be empty and are omitted entirely if so. Order is fixed; the
// later a section appears, the closer it is to the user message and the more
// the model treats it as "active context".

import type { Mode } from "../permissions/pipeline.js";

export interface PromptSections {
  identity?: string;
  environment?: string;
  memory_index?: string;
  agents_md?: string;
  skills?: string;
  mode?: string;
  custom?: string;
}

const SECTION_ORDER: (keyof PromptSections)[] = [
  "identity",
  "environment",
  "memory_index",
  "agents_md",
  "skills",
  "mode",
  "custom",
];

const SECTION_HEADER: Record<keyof PromptSections, string> = {
  identity: "## Identity",
  environment: "## Environment",
  memory_index: "## Remembered notes (load full value with the `recall` tool)",
  agents_md: "## Repo conventions (auto-loaded from AGENTS.md)",
  skills: "## Available skills (load with the `skill` tool)",
  mode: "## Permission mode",
  custom: "## Operating rules",
};

export function buildSystemPrompt(sections: PromptSections): string {
  const out: string[] = [];
  for (const key of SECTION_ORDER) {
    const body = sections[key]?.trim();
    if (!body) continue;
    out.push(`${SECTION_HEADER[key]}\n${body}`);
  }
  return out.join("\n\n");
}

export function defaultIdentity(): string {
  return [
    "You are open-agent, a CLI assistant built on the agent loop from",
    "https://learn.shareai.run/en/. You operate via tool use only -- you cannot",
    "see the user's screen, only message history and tool results.",
  ].join("\n");
}

export function defaultRules(): string {
  return [
    "- Use todo_write when a task has 3+ steps. Keep at most one todo in_progress.",
    "- Inspect before writing: prefer read_file / run_shell to confirm assumptions.",
    "- Use subagent for parallelizable read-only searches.",
    "- Load a skill via the `skill` tool when its description matches the task; don't",
    "  ask the user first.",
    "- Save durable facts to long-term memory via `memorize`. Don't use it as scratch.",
    "- Be concise in chat. Tool results already appear inline; don't restate them.",
  ].join("\n");
}

export function modeSection(mode: Mode): string {
  switch (mode) {
    case "yolo":
      return "Mode: **yolo** -- all tools auto-approved. Move fast; verify before writes.";
    case "plan":
      return "Mode: **plan** -- write tools are denied. Describe the change instead.";
    default:
      return "Mode: **default** -- write tools require user approval before each call.";
  }
}

export function environmentSection(cwd: string, platform: string): string {
  return [`Working directory: ${cwd}`, `Platform: ${platform}`].join("\n");
}
