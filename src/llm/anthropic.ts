// Anthropic provider -- the original implementation, now behind the Provider
// interface so the dispatcher can pick between backends.

import Anthropic from "@anthropic-ai/sdk";
import type { CallModelOptions, CallModelResponse, Provider } from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 4096;

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;
  private defaultModel: string;

  constructor(model?: string) {
    this.defaultModel = model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY not set. Add it to .env (or set LLM_PROVIDER to use another backend).",
        );
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async callModel(opts: CallModelOptions): Promise<CallModelResponse> {
    const client = this.getClient();
    const apiTools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const resp = await client.messages.create({
      model: opts.model ?? this.defaultModel,
      max_tokens: opts.maxTokens ?? MAX_TOKENS,
      system: opts.system,
      tools: apiTools,
      messages: opts.messages,
    });

    return {
      content: resp.content,
      stop_reason: resp.stop_reason,
      usage: {
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
      },
    };
  }
}
