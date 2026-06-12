// s18 Worktree Isolation.
//
// Tasks answer WHAT. Worktrees answer WHERE. Keep them separate.
//
// This module manages git worktrees so concurrent tasks can edit files
// without stepping on each other. Each worktree is a checkout of a fresh
// branch under a temp directory. The agent's cwd for that task is the
// worktree path.
//
// Operations are best-effort: if `git` isn't available or the cwd isn't a
// repo, we surface the error to the model so it can fall back to in-place
// edits or escalate.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { promises as fs } from "node:fs";

const execAsync = promisify(exec);

export interface Worktree {
  branch: string;
  path: string;
  base: string;
  created_at: string;
}

export class WorktreeManager {
  private worktrees = new Map<string, Worktree>();

  constructor(private repoRoot: string) {}

  async create(branchName: string, base = "HEAD"): Promise<Worktree> {
    if (this.worktrees.has(branchName)) {
      return this.worktrees.get(branchName)!;
    }
    const wtRoot = path.join(this.repoRoot, ".open-agent", "worktrees");
    await fs.mkdir(wtRoot, { recursive: true });
    const wtPath = path.join(wtRoot, branchName.replace(/[\/\\:*?"<>|]/g, "_"));

    // Create the branch from base, then add the worktree.
    await execAsync(`git worktree add -b ${shellEscape(branchName)} ${shellEscape(wtPath)} ${shellEscape(base)}`, {
      cwd: this.repoRoot,
    });

    const wt: Worktree = {
      branch: branchName,
      path: wtPath,
      base,
      created_at: new Date().toISOString(),
    };
    this.worktrees.set(branchName, wt);
    return wt;
  }

  async remove(branchName: string, deleteBranch = true): Promise<void> {
    const wt = this.worktrees.get(branchName);
    if (!wt) throw new Error(`No such worktree: ${branchName}`);
    await execAsync(`git worktree remove --force ${shellEscape(wt.path)}`, { cwd: this.repoRoot });
    if (deleteBranch) {
      try {
        await execAsync(`git branch -D ${shellEscape(branchName)}`, { cwd: this.repoRoot });
      } catch {
        /* branch may already be gone */
      }
    }
    this.worktrees.delete(branchName);
  }

  list(): Worktree[] {
    return [...this.worktrees.values()];
  }

  get(branchName: string): Worktree | undefined {
    return this.worktrees.get(branchName);
  }
}

function shellEscape(s: string): string {
  // Minimal quoting for paths and branch names. Avoids spaces/special chars.
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}
