// s09 Memory System.
//
// Two layers, deliberately separate:
//
//  1. AGENTS.md (auto-loaded into the system prompt)
//     - Repo-level rules and conventions the agent should always know.
//     - Walks from cwd up to the filesystem root, collecting every AGENTS.md.
//     - Closer files take precedence (added later in the prompt).
//
//  2. Structured memory store (.open-agent/memory.json)
//     - Key/value notes the agent has chosen to remember across sessions.
//     - Manipulated via the `memorize` and `recall` tools.
//
// Slogan: memory gives direction; current observation gives truth.

import { promises as fs } from "node:fs";
import path from "node:path";

const STORE_DIRNAME = ".open-agent";
const STORE_FILE = "memory.json";

// ---- AGENTS.md auto-loader ---------------------------------------------

export async function loadAgentsMd(startDir: string): Promise<string> {
  const found: string[] = [];
  let dir = path.resolve(startDir);
  // walk up to 8 levels to find AGENTS.md files
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "AGENTS.md");
    try {
      const raw = await fs.readFile(candidate, "utf8");
      found.unshift(`### From ${candidate}\n${raw.trim()}`);
    } catch {
      /* not present, fine */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found.join("\n\n");
}

// ---- Persistent memory store -------------------------------------------

export interface MemoryEntry {
  key: string;
  value: string;
  type?: MemoryType;
  description?: string;
  created_at: string;
}

export type MemoryType = "user" | "feedback" | "project" | "reference";

export class MemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private file: string;

  constructor(rootDir: string) {
    this.file = path.join(rootDir, STORE_DIRNAME, STORE_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const arr = JSON.parse(raw) as MemoryEntry[];
      for (const e of arr) this.entries.set(e.key, e);
    } catch {
      /* missing file is OK */
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const arr = [...this.entries.values()];
    await fs.writeFile(this.file, JSON.stringify(arr, null, 2), "utf8");
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, { key, value, created_at: new Date().toISOString() });
    await this.save();
  }

  async setExtracted(entry: {
    key: string;
    value: string;
    type: MemoryType;
    description: string;
  }): Promise<void> {
    this.entries.set(entry.key, {
      key: entry.key,
      value: entry.value,
      type: entry.type,
      description: entry.description,
      created_at: new Date().toISOString(),
    });
    await this.save();
  }

  get(key: string): string | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  async delete(key: string): Promise<boolean> {
    const had = this.entries.delete(key);
    if (had) await this.save();
    return had;
  }

  list(): MemoryEntry[] {
    return [...this.entries.values()];
  }

  // Short summary for the system prompt; full text only when recalled.
  summary(): string {
    if (this.entries.size === 0) return "(no remembered notes)";
    return this.list()
      .map((e) => {
        const type = e.type ? `[${e.type}] ` : "";
        const text = e.description || truncate(e.value, 80);
        return `- ${type}${e.key}: ${text}`;
      })
      .join("\n");
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
