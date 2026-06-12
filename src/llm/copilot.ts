// GitHub Copilot provider.
//
// Uses Copilot's OpenAI-compatible chat-completions endpoint. Authentication
// flow:
//
//   1. Get a GitHub PAT. Either env var GITHUB_TOKEN, or run `gh auth token`.
//   2. Exchange it for a short-lived Copilot session token via
//      https://api.github.com/copilot_internal/v2/token.
//   3. Cache the session token until its expiry, then refresh.
//
// Requires an active GitHub Copilot subscription on the GitHub account.
//
// Note: the Copilot chat endpoint is undocumented and may change. This is
// intended for personal / experimental use.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CallModelOptions, CallModelResponse, Provider } from "./types.js";
import {
  fromOpenAIResponse,
  postJson,
  toOpenAIMessages,
  toOpenAITools,
  type OpenAIChatResponse,
} from "./openai-compat.js";
import { deviceFlowLogin, loadCachedToken, saveCachedToken, clearCachedToken } from "./copilot-auth.js";

const execAsync = promisify(exec);

const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_CHAT_URL = "https://api.githubcopilot.com/chat/completions";
const COPILOT_MODELS_URL = "https://api.githubcopilot.com/models";
const DEFAULT_MODEL = "gpt-4o";

interface CopilotToken {
  token: string;
  expires_at: number; // unix seconds
}

export class CopilotProvider implements Provider {
  readonly name = "copilot";
  private session: CopilotToken | null = null;
  private defaultModel: string;
  private retriedAfterClear = false;

  constructor(model?: string) {
    this.defaultModel = model ?? process.env.COPILOT_MODEL ?? DEFAULT_MODEL;
  }

  private async getGitHubToken(): Promise<string> {
    // 1. Explicit env vars take priority.
    if (process.env.GITHUB_COPILOT_TOKEN) return process.env.GITHUB_COPILOT_TOKEN;
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

    // 2. `gh auth token` if the user has the GitHub CLI logged in.
    try {
      const { stdout } = await execAsync("gh auth token");
      const token = stdout.trim();
      if (token) return token;
    } catch {
      /* gh not installed or not logged in -- fall through */
    }

    // 3. On-disk cache from a previous device-flow login.
    const cached = await loadCachedToken();
    if (cached) return cached;

    // 4. Trigger interactive device flow as a last resort.
    if (process.env.OPEN_AGENT_NO_DEVICE_FLOW) {
      throw new Error(
        "No GitHub token. Set GITHUB_COPILOT_TOKEN or GITHUB_TOKEN, run `gh auth login`, " +
          "or unset OPEN_AGENT_NO_DEVICE_FLOW to enable interactive device-flow login.",
      );
    }
    const fresh = await deviceFlowLogin();
    await saveCachedToken(fresh);
    return fresh;
  }

  private async getSessionToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.session && this.session.expires_at - 60 > now) {
      return this.session.token;
    }
    const ghToken = await this.getGitHubToken();
    const res = await fetch(COPILOT_TOKEN_URL, {
      headers: {
        authorization: `Bearer ${ghToken}`,
        "user-agent": "open-agent/0.1",
        accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // If a cached/stale GitHub token was revoked, drop it and retry once
      // via the device flow so the user isn't stuck re-running by hand.
      const tokenLooksStale = res.status === 401 || res.status === 403;
      const usedExplicitToken =
        !!process.env.GITHUB_COPILOT_TOKEN || !!process.env.GITHUB_TOKEN;
      if (tokenLooksStale && !usedExplicitToken && !this.retriedAfterClear) {
        this.retriedAfterClear = true;
        await clearCachedToken();
        // Force re-auth on next call by resetting the session cache too.
        this.session = null;
        return this.getSessionToken();
      }
      throw new Error(
        `Copilot token exchange failed (${res.status}). ` +
          `Is the Copilot subscription active on this account? Body: ${body.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as { token: string; expires_at: number };
    this.session = { token: data.token, expires_at: data.expires_at };
    this.retriedAfterClear = false;
    return data.token;
  }

  async callModel(opts: CallModelOptions): Promise<CallModelResponse> {
    const sessionToken = await this.getSessionToken();
    const body = {
      model: opts.model ?? this.defaultModel,
      max_tokens: opts.maxTokens ?? 4096,
      messages: toOpenAIMessages(opts.system, opts.messages),
      ...(opts.tools.length > 0 ? { tools: toOpenAITools(opts.tools) } : {}),
    };
    const resp = (await postJson(
      COPILOT_CHAT_URL,
      {
        authorization: `Bearer ${sessionToken}`,
        "editor-version": "vscode/1.95.0",
        "editor-plugin-version": "copilot-chat/0.20.0",
        "copilot-integration-id": "vscode-chat",
        "user-agent": "open-agent/0.1",
      },
      body,
    )) as OpenAIChatResponse;
    return fromOpenAIResponse(resp);
  }
}
