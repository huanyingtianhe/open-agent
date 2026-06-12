// s13 Background Tasks.
//
// "Background execution is a runtime lane, not a second main loop."
//
// A BackgroundRunner spawns an agent invocation that runs concurrently with
// the foreground REPL. Internally it's still the same runAgent() loop -- only
// the lifecycle is different (no readline I/O, results captured to memory).
//
// Tools:
//   - background_start  : kick off, returns id
//   - background_status : peek state
//   - background_result : block until finished, return final text

import { randomUUID } from "node:crypto";

export type BgStatus = "running" | "succeeded" | "failed";

export interface BgJob {
  id: string;
  prompt: string;
  status: BgStatus;
  started_at: string;
  finished_at?: string;
  result?: string;
  error?: string;
}

type Runner = (prompt: string, jobId: string) => Promise<string>;

export class BackgroundRunner {
  private jobs = new Map<string, BgJob>();
  private promises = new Map<string, Promise<void>>();

  constructor(private runner: Runner) {}

  start(prompt: string): BgJob {
    const id = randomUUID().slice(0, 8);
    const job: BgJob = { id, prompt, status: "running", started_at: new Date().toISOString() };
    this.jobs.set(id, job);

    const p = (async () => {
      try {
        const result = await this.runner(prompt, id);
        job.status = "succeeded";
        job.result = result;
      } catch (err) {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
      } finally {
        job.finished_at = new Date().toISOString();
      }
    })();
    this.promises.set(id, p);
    return job;
  }

  get(id: string): BgJob | undefined {
    return this.jobs.get(id);
  }

  list(): BgJob[] {
    return [...this.jobs.values()];
  }

  async await(id: string, timeoutMs?: number): Promise<BgJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`No such job: ${id}`);
    const p = this.promises.get(id);
    if (!p) return job;
    if (timeoutMs) {
      await Promise.race([
        p,
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error("await timeout")), timeoutMs)),
      ]);
    } else {
      await p;
    }
    return job;
  }
}
