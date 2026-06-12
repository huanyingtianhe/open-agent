// Azure OpenAI provider.
//
// Endpoint pattern:
//   {AZURE_OPENAI_ENDPOINT}/openai/deployments/{AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version={AZURE_OPENAI_API_VERSION}
//
// Auth: API key via `api-key` header (default), or AAD bearer token via
// `Authorization: Bearer ...` if AZURE_OPENAI_BEARER_TOKEN is set.
//
// The wire format is OpenAI chat-completions, so we share the same
// translation helpers used by the Copilot provider.

import type { CallModelOptions, CallModelResponse, Provider } from "./types.js";
import {
  fromOpenAIResponse,
  postJson,
  toOpenAIMessages,
  toOpenAITools,
  type OpenAIChatResponse,
} from "./openai-compat.js";

const DEFAULT_API_VERSION = "2024-10-21";

export class AzureOpenAIProvider implements Provider {
  readonly name = "azure-openai";
  private endpoint: string;
  private deployment: string;
  private apiVersion: string;
  private apiKey?: string;
  private bearerToken?: string;

  constructor() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    if (!endpoint) throw new Error("AZURE_OPENAI_ENDPOINT not set");
    if (!deployment) throw new Error("AZURE_OPENAI_DEPLOYMENT not set");

    this.endpoint = endpoint.replace(/\/+$/, "");
    this.deployment = deployment;
    this.apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? DEFAULT_API_VERSION;
    this.apiKey = process.env.AZURE_OPENAI_API_KEY;
    this.bearerToken = process.env.AZURE_OPENAI_BEARER_TOKEN;

    if (!this.apiKey && !this.bearerToken) {
      throw new Error(
        "Azure OpenAI auth missing: set AZURE_OPENAI_API_KEY or AZURE_OPENAI_BEARER_TOKEN.",
      );
    }
  }

  private url(): string {
    return `${this.endpoint}/openai/deployments/${encodeURIComponent(this.deployment)}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  private authHeaders(): Record<string, string> {
    if (this.bearerToken) return { authorization: `Bearer ${this.bearerToken}` };
    return { "api-key": this.apiKey! };
  }

  async callModel(opts: CallModelOptions): Promise<CallModelResponse> {
    // Azure ignores `model` (deployment is in the URL) but accepts it harmlessly.
    const body = {
      max_tokens: opts.maxTokens ?? 4096,
      messages: toOpenAIMessages(opts.system, opts.messages),
      ...(opts.tools.length > 0 ? { tools: toOpenAITools(opts.tools) } : {}),
    };
    const resp = (await postJson(
      this.url(),
      { ...this.authHeaders(), "user-agent": "open-agent/0.1" },
      body,
    )) as OpenAIChatResponse;
    return fromOpenAIResponse(resp);
  }
}
