// s17 Autonomous Agents.
//
// Autonomy is the mechanical loop:  idle -> scan -> claim -> resume -> emit.
// It is NOT special. It just repeatedly invokes the same agent loop, using
// the team inbox as its event source.
//
// For each registered teammate:
//   1. idle: sleep TICK_MS
//   2. scan: list pending messages addressed to me
//   3. claim: mark the oldest one "claimed" (atomically via TeamStore)
//   4. resume: run runAgent() with the teammate's system_prompt and the
//      message body as the user prompt
//   5. emit: post a "response" message in_reply_to the original request id
//
// We stop on stop() or process exit. No worker threads -- one in-process
// loop per teammate is enough for educational purposes.

import type { TeamStore, Teammate } from "../teams/store.js";

export type AgentResponder = (teammate: Teammate, prompt: string) => Promise<string>;

const TICK_MS = 2_000;

interface Watcher {
  teammate: string;
  active: boolean;
  loops: number;
  last_message_id?: string;
}

export class AutonomousLoop {
  private watchers = new Map<string, Watcher>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private store: TeamStore, private responder: AgentResponder) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // Register a watcher per teammate that exists at start.
    for (const t of this.store.listTeammates()) {
      this.watchers.set(t.name, { teammate: t.name, active: false, loops: 0 });
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  status(): Watcher[] {
    return [...this.watchers.values()];
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    // Pick up any newly-hired teammates.
    for (const t of this.store.listTeammates()) {
      if (!this.watchers.has(t.name)) {
        this.watchers.set(t.name, { teammate: t.name, active: false, loops: 0 });
      }
    }
    for (const w of this.watchers.values()) {
      if (w.active) continue;
      const teammate = this.store.getTeammate(w.teammate);
      if (!teammate) continue;

      const pending = this.store.pending(teammate.name);
      if (pending.length === 0) continue;

      const msg = pending[0];
      // Claim atomically so a parallel tick doesn't re-process it.
      await this.store.setStatus(msg.id, "claimed");
      w.active = true;
      w.last_message_id = msg.id;

      // Fire and forget; the loop continues while this teammate answers.
      (async () => {
        try {
          const answer = await this.responder(teammate, `[from ${msg.from}] ${msg.subject}\n\n${msg.body}`);
          await this.store.send({
            from: teammate.name,
            to: msg.from,
            in_reply_to: msg.id,
            type: "response",
            subject: `Re: ${msg.subject}`,
            body: answer,
          });
          await this.store.setStatus(msg.id, "answered");
        } catch (err) {
          await this.store.send({
            from: teammate.name,
            to: msg.from,
            in_reply_to: msg.id,
            type: "response",
            subject: `Error: ${msg.subject}`,
            body: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          await this.store.setStatus(msg.id, "answered");
        } finally {
          w.active = false;
          w.loops++;
        }
      })();
    }
  }
}
