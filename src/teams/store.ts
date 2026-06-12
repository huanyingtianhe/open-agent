// s15 Agent Teams + s16 Team Protocols.
//
// A teammate is a persisted identity:
//   - name, role, system_prompt
//   - a durable inbox of protocol messages
//
// All inter-agent traffic uses the same envelope (s16):
//
//   { id, from, to, in_reply_to?, type: "request" | "response" | "broadcast",
//     subject, body, status: "pending" | "claimed" | "answered", ts }
//
// Replies reference the original request via `in_reply_to`. That correlation
// id is the only thing protocols need; everything else (deadlines, priorities)
// is just convention layered on top.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const STORE_DIRNAME = ".open-agent";
const TEAM_FILE = "team.json";

export interface Teammate {
  name: string;
  role: string;
  system_prompt: string;
  created_at: string;
}

export type MsgType = "request" | "response" | "broadcast";
export type MsgStatus = "pending" | "claimed" | "answered";

export interface ProtocolMessage {
  id: string;
  from: string;
  to: string; // teammate name or "*" for broadcast
  in_reply_to?: string;
  type: MsgType;
  subject: string;
  body: string;
  status: MsgStatus;
  ts: string;
}

interface TeamFile {
  teammates: Teammate[];
  inbox: ProtocolMessage[];
}

export class TeamStore {
  private data: TeamFile = { teammates: [], inbox: [] };
  private file: string;

  constructor(rootDir: string) {
    this.file = path.join(rootDir, STORE_DIRNAME, TEAM_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.data = JSON.parse(raw) as TeamFile;
    } catch {
      /* missing file is OK */
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), "utf8");
  }

  // ---- teammates ----
  async addTeammate(name: string, role: string, systemPrompt: string): Promise<Teammate> {
    if (this.data.teammates.find((t) => t.name === name)) {
      throw new Error(`Teammate already exists: ${name}`);
    }
    const t: Teammate = { name, role, system_prompt: systemPrompt, created_at: new Date().toISOString() };
    this.data.teammates.push(t);
    await this.save();
    return t;
  }

  listTeammates(): Teammate[] {
    return this.data.teammates.slice();
  }

  getTeammate(name: string): Teammate | undefined {
    return this.data.teammates.find((t) => t.name === name);
  }

  // ---- messaging ----
  async send(msg: Omit<ProtocolMessage, "id" | "status" | "ts">): Promise<ProtocolMessage> {
    const full: ProtocolMessage = {
      ...msg,
      id: randomUUID().slice(0, 8),
      status: "pending",
      ts: new Date().toISOString(),
    };
    this.data.inbox.push(full);
    await this.save();
    return full;
  }

  // Read pending messages addressed to `to` (or "*").
  pending(to: string): ProtocolMessage[] {
    return this.data.inbox.filter(
      (m) => m.status === "pending" && (m.to === to || m.to === "*"),
    );
  }

  // Find a response to a previously-sent request.
  responseTo(requestId: string): ProtocolMessage | undefined {
    return this.data.inbox.find((m) => m.in_reply_to === requestId && m.type === "response");
  }

  async setStatus(id: string, status: MsgStatus): Promise<void> {
    const m = this.data.inbox.find((x) => x.id === id);
    if (m) {
      m.status = status;
      await this.save();
    }
  }

  allMessages(): ProtocolMessage[] {
    return this.data.inbox.slice();
  }
}
