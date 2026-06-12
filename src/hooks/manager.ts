// s08 Hook System.
// The agent loop owns control flow; hooks only OBSERVE, BLOCK, or ANNOTATE
// at named moments. They never call the model or other tools themselves.
//
// Lifecycle events fired by agent.ts:
//   - before_model_call : { messages, system }
//   - after_model_call  : { response }
//   - before_tool_call  : { tool_name, input }   <- may return { block }
//   - after_tool_call   : { tool_name, output }
//   - on_error          : { phase, error }
//
// A hook may return:
//   - undefined / null  -> pass through unchanged
//   - { patch: ... }    -> shallow-merge into the payload
//   - { block: reason } -> only valid for before_* events; aborts that step

import type { ApiMessage, ContentBlock } from "../types.js";

export type HookEvent =
  | "before_model_call"
  | "after_model_call"
  | "before_tool_call"
  | "after_tool_call"
  | "on_error";

export interface HookPayloads {
  before_model_call: { messages: ApiMessage[]; system: string };
  after_model_call: { response: { content: ContentBlock[]; stop_reason: string | null } };
  before_tool_call: { tool_name: string; input: unknown };
  after_tool_call: { tool_name: string; output: unknown; is_error: boolean };
  on_error: { phase: string; error: Error };
}

export type HookResult<E extends HookEvent> =
  | void
  | null
  | undefined
  | { patch: Partial<HookPayloads[E]> }
  | { block: string };

export type HookFn<E extends HookEvent> = (
  payload: HookPayloads[E],
) => Promise<HookResult<E>> | HookResult<E>;

interface RegisteredHook<E extends HookEvent = HookEvent> {
  event: E;
  name: string;
  fn: HookFn<E>;
}

export class HookManager {
  private hooks: RegisteredHook[] = [];

  register<E extends HookEvent>(event: E, name: string, fn: HookFn<E>): void {
    this.hooks.push({ event, name, fn } as RegisteredHook);
  }

  // Run all hooks for an event in registration order.
  // Returns either { block } if any hook blocked, or the (possibly mutated) payload.
  async fire<E extends HookEvent>(
    event: E,
    payload: HookPayloads[E],
  ): Promise<{ blocked: false; payload: HookPayloads[E] } | { blocked: true; reason: string }> {
    let current = payload;
    for (const h of this.hooks) {
      if (h.event !== event) continue;
      const result = await (h.fn as HookFn<E>)(current);
      if (!result) continue;
      if ("block" in result) {
        return { blocked: true, reason: `[${h.name}] ${result.block}` };
      }
      if ("patch" in result) {
        current = { ...current, ...result.patch };
      }
    }
    return { blocked: false, payload: current };
  }

  list(): { event: HookEvent; name: string }[] {
    return this.hooks.map((h) => ({ event: h.event, name: h.name }));
  }
}
