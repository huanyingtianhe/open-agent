import { callModel } from "../llm.js";
import type { ApiMessage, ContentBlock } from "../types.js";
import { MemoryStore, type MemoryType } from "./store.js";

interface ExtractedMemory {
  name: string;
  type: MemoryType;
  description: string;
  body: string;
}

const MEMORY_TYPES = new Set<MemoryType>(["user", "feedback", "project", "reference"]);

export async function extractMemoriesAfterTurn(
  store: MemoryStore,
  messages: ApiMessage[],
): Promise<number> {
  const dialogue = formatRecentMessages(messages.slice(-10));
  if (!dialogue.trim()) return 0;

  const existing = store
    .list()
    .map((entry) => {
      const type = entry.type ? `[${entry.type}] ` : "";
      const description = entry.description || entry.value;
      return `- ${type}${entry.key}: ${description}`;
    })
    .join("\n");

  const prompt = [
    "Extract durable long-term memories from the dialogue.",
    "Return only a JSON array. If there is nothing new or everything is already covered, return [].",
    "Each item must have: name, type, description, body.",
    "Allowed type values:",
    "- user: stable user preferences, identity, or personal working style",
    "- feedback: recurring feedback about how the assistant should work",
    "- project: durable facts, constraints, decisions, or context about this project",
    "- reference: useful pointers to where information, bugs, tasks, or systems live",
    "Do not save transient task state, one-off commands, secrets, credentials, or obvious facts from the current answer.",
    "Prefer concise names in kebab-case and descriptions under 120 characters.",
    "",
    `Existing memories:\n${existing || "(none)"}`,
    "",
    `Dialogue:\n${dialogue.slice(0, 6000)}`,
  ].join("\n");

  let responseText = "";
  try {
    const response = await callModel({
      system: "You are a careful memory extraction subsystem. You only emit valid JSON.",
      messages: [{ role: "user", content: prompt }],
      tools: [],
      maxTokens: 1200,
    });
    responseText = response.content
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  } catch {
    return 0;
  }

  const extracted = parseExtractedMemories(responseText);
  let saved = 0;
  for (const memory of extracted) {
    const key = slugify(memory.name);
    if (!key || store.has(key)) continue;
    await store.setExtracted({
      key,
      type: memory.type,
      description: memory.description.trim(),
      value: memory.body.trim(),
    });
    saved++;
  }
  return saved;
}

function parseExtractedMemories(text: string): ExtractedMemory[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isExtractedMemory);
  } catch {
    return [];
  }
}

function extractJsonArray(text: string): string | undefined {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return undefined;
  return text.slice(start, end + 1);
}

function isExtractedMemory(value: unknown): value is ExtractedMemory {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    MEMORY_TYPES.has(candidate.type as MemoryType) &&
    typeof candidate.description === "string" &&
    typeof candidate.body === "string" &&
    candidate.description.trim().length > 0 &&
    candidate.body.trim().length > 0
  );
}

function formatRecentMessages(messages: ApiMessage[]): string {
  return messages
    .map((message) => {
      const content = typeof message.content === "string" ? message.content : formatBlocks(message.content);
      return `${message.role}: ${content}`;
    })
    .join("\n\n");
}

function formatBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_use") return `[tool_use ${block.name} ${JSON.stringify(block.input)}]`;
      if (block.type === "tool_result") {
        const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        return `[tool_result${block.is_error ? " error" : ""} ${content}]`;
      }
      return JSON.stringify(block);
    })
    .filter(Boolean)
    .join("\n");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}