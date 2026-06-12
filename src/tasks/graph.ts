// s12 Task System.
//
// Todo lists (s03) help a *single session*. Tasks here are durable: they live
// in .open-agent/tasks.json and survive process restart. Each task has
// dependencies, so this is really a small dependency graph.
//
// Status lifecycle:  pending -> ready -> in_progress -> done | failed | blocked
//
// A task becomes "ready" when every dep is "done".

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type TaskStatus = "pending" | "ready" | "in_progress" | "done" | "failed" | "blocked";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  deps: string[];
  worktree?: string; // s18 link
  result?: string;
  error?: string;
  parent?: string;
  created_at: string;
  updated_at: string;
}

const STORE_DIRNAME = ".open-agent";
const STORE_FILE = "tasks.json";

export class TaskGraph {
  private tasks = new Map<string, Task>();
  private file: string;

  constructor(rootDir: string) {
    this.file = path.join(rootDir, STORE_DIRNAME, STORE_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      for (const t of JSON.parse(raw) as Task[]) this.tasks.set(t.id, t);
    } catch {
      /* missing file is OK */
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify([...this.tasks.values()], null, 2), "utf8");
  }

  async create(input: {
    title: string;
    description?: string;
    deps?: string[];
    parent?: string;
    worktree?: string;
  }): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID().slice(0, 8),
      title: input.title,
      description: input.description ?? "",
      status: this.computeStatus(input.deps ?? []),
      deps: input.deps ?? [],
      worktree: input.worktree,
      parent: input.parent,
      created_at: now,
      updated_at: now,
    };
    this.tasks.set(task.id, task);
    await this.save();
    await this.propagate();
    return task;
  }

  async update(id: string, patch: Partial<Pick<Task, "status" | "result" | "error">>): Promise<Task> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    Object.assign(t, patch, { updated_at: new Date().toISOString() });
    await this.save();
    await this.propagate();
    return t;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(filter?: { status?: TaskStatus }): Task[] {
    const all = [...this.tasks.values()];
    return filter?.status ? all.filter((t) => t.status === filter.status) : all;
  }

  // After any change, recompute ready states for pending tasks whose deps are now done.
  private async propagate(): Promise<void> {
    let changed = false;
    for (const t of this.tasks.values()) {
      if (t.status !== "pending") continue;
      const newStatus = this.computeStatus(t.deps);
      if (newStatus !== t.status) {
        t.status = newStatus;
        t.updated_at = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  private computeStatus(deps: string[]): TaskStatus {
    if (deps.length === 0) return "ready";
    for (const d of deps) {
      const dep = this.tasks.get(d);
      if (!dep) return "pending"; // dep doesn't exist yet
      if (dep.status === "failed" || dep.status === "blocked") return "blocked";
      if (dep.status !== "done") return "pending";
    }
    return "ready";
  }
}
