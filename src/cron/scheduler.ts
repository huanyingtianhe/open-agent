// s14 Cron Scheduler.
//
// "Scheduling is not a separate system -- it just feeds the same agent loop
// from a timer."
//
// Config lives in .open-agent/cron.json:
//   [{ "id": "morning-report", "interval_seconds": 3600, "prompt": "..." }]
//
// On each tick we hand the prompt to the BackgroundRunner -- so cron-triggered
// runs go through the exact same path as user-triggered background work.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { BackgroundRunner } from "../background/runner.js";

export interface CronJob {
  id: string;
  interval_seconds: number;
  prompt: string;
  // populated at runtime:
  next_run?: number;
  last_run?: number;
  last_job_id?: string;
}

const CRON_FILE = ".open-agent/cron.json";
const TICK_MS = 5_000;

export class CronScheduler {
  private jobs: CronJob[] = [];
  private timer?: NodeJS.Timeout;
  private file: string;

  constructor(rootDir: string, private runner: BackgroundRunner) {
    this.file = path.join(rootDir, CRON_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.jobs = JSON.parse(raw) as CronJob[];
      const now = Date.now();
      for (const j of this.jobs) j.next_run = now + j.interval_seconds * 1000;
    } catch {
      this.jobs = [];
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  list(): CronJob[] {
    return this.jobs.slice();
  }

  private tick(): void {
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.next_run && now >= job.next_run) {
        const bg = this.runner.start(`[cron:${job.id}] ${job.prompt}`);
        job.last_run = now;
        job.last_job_id = bg.id;
        job.next_run = now + job.interval_seconds * 1000;
      }
    }
  }
}
