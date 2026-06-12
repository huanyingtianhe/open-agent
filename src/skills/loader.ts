// s05 Skills: discover cheaply, load deeply.
// Walk the skills/ directory at startup, read only the YAML frontmatter
// (name + description). Skill bodies are loaded on demand by the `skill` tool.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export interface SkillIndexEntry {
  name: string;
  description: string;
  path: string; // absolute path to SKILL.md
}

export class SkillIndex {
  private entries = new Map<string, SkillIndexEntry>();
  constructor(private skillsDir: string) {}

  async load(): Promise<void> {
    let dirs: string[] = [];
    try {
      dirs = await fs.readdir(this.skillsDir);
    } catch {
      return; // skills dir is optional
    }
    for (const d of dirs) {
      const file = path.join(this.skillsDir, d, "SKILL.md");
      try {
        const raw = await fs.readFile(file, "utf8");
        const { data } = matter(raw);
        const name = String(data.name ?? d);
        const description = String(data.description ?? "");
        this.entries.set(name, { name, description, path: file });
      } catch {
        // Skip directories without SKILL.md
      }
    }
  }

  list(): SkillIndexEntry[] {
    return [...this.entries.values()];
  }

  get(name: string): SkillIndexEntry | undefined {
    return this.entries.get(name);
  }

  async loadBody(name: string): Promise<string> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unknown skill: ${name}`);
    const raw = await fs.readFile(entry.path, "utf8");
    const { content } = matter(raw);
    return content.trim();
  }

  // Compact line-per-skill summary for the system prompt.
  summary(): string {
    if (this.entries.size === 0) return "(no skills available)";
    return this.list()
      .map((e) => `- ${e.name}: ${e.description}`)
      .join("\n");
  }
}
