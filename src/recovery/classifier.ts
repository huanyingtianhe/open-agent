// s11 Error Recovery.
//
// Most failures aren't true task failure -- they're signals to try a different
// path. This classifier converts a thrown Error or a ToolError message into
// one of three recovery actions:
//
//   - retry    : transient (network, rate limit, timeout) -- back off and try again
//   - replan   : real problem the model can recover from -- surface to model as
//                a tool_result so it picks a different approach
//   - escalate : we can't make progress without the user -- bubble up
//
// The agent loop wraps every tool call and every model call with classify().

export type RecoveryAction =
  | { kind: "retry"; delay_ms: number; max_attempts: number }
  | { kind: "replan" } // make it the model's problem
  | { kind: "escalate"; reason: string };

const RETRYABLE_PATTERNS = [
  /rate.?limit/i,
  /overloaded/i,
  /timeout/i,
  /etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /\b502\b|\b503\b|\b504\b/,
  /socket hang up/i,
];

const ESCALATE_PATTERNS = [
  /ANTHROPIC_API_KEY/, // auth misconfig -- user action required
  /invalid api key/i,
  /unauthorized/i,
  /quota exceeded/i,
  /insufficient_quota/i,
];

export function classify(err: unknown, attempt: number): RecoveryAction {
  const msg = err instanceof Error ? err.message : String(err);

  for (const p of ESCALATE_PATTERNS) {
    if (p.test(msg)) return { kind: "escalate", reason: msg };
  }
  for (const p of RETRYABLE_PATTERNS) {
    if (p.test(msg)) {
      if (attempt >= 3) return { kind: "escalate", reason: `Still failing after retries: ${msg}` };
      return { kind: "retry", delay_ms: 500 * 2 ** attempt, max_attempts: 3 };
    }
  }
  // Default: let the model see it and try something else.
  return { kind: "replan" };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Convenience wrapper: retry a function according to classify().
// Throws (escalates) when the classifier says so or when replan would loop.
export async function withRetry<T>(fn: () => Promise<T>, label = "op"): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const action = classify(err, attempt);
      if (action.kind === "escalate") throw err;
      if (action.kind === "replan") throw err; // caller turns this into tool_result
      // retry
      await sleep(action.delay_ms);
      attempt++;
      if (attempt >= action.max_attempts) throw err;
      // eslint-disable-next-line no-console
      console.log(`[recovery] ${label}: retrying (attempt ${attempt + 1})`);
    }
  }
}
