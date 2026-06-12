// LLM provider dispatcher.
//
// One env var (LLM_PROVIDER) picks the backend. Everything else in the codebase
// imports `callModel` from this file and stays oblivious to which provider is
// in use. To add a new provider:
//   1. Implement the Provider interface (src/llm/types.ts)
//   2. Add a case to pickProvider()
//   3. Document its env vars in .env.example
//
// Supported today:
//   anthropic     -> ANTHROPIC_API_KEY (default)
//   copilot       -> GitHub Copilot subscription; auto-picks up `gh auth token`
//   azure-openai  -> AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT + key/AAD

import type { CallModelOptions, CallModelResponse, Provider, ProviderId } from "./llm/types.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import { CopilotProvider } from "./llm/copilot.js";
import { AzureOpenAIProvider } from "./llm/azure.js";

export type { CallModelOptions, CallModelResponse } from "./llm/types.js";

let cached: Provider | null = null;

function pickProvider(): Provider {
  const id = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase() as ProviderId;
  switch (id) {
    case "anthropic":
      return new AnthropicProvider();
    case "copilot":
      return new CopilotProvider();
    case "azure-openai":
      return new AzureOpenAIProvider();
    default:
      throw new Error(
        `Unknown LLM_PROVIDER=${id}. Expected: anthropic | copilot | azure-openai.`,
      );
  }
}

export function getProvider(): Provider {
  if (!cached) cached = pickProvider();
  return cached;
}

// Public API used by the agent loop.
export async function callModel(opts: CallModelOptions): Promise<CallModelResponse> {
  return getProvider().callModel(opts);
}

// For diagnostics / banner. Doesn't construct the provider, so it's safe to
// call even when required env vars are missing.
export function providerName(): string {
  return (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
}
