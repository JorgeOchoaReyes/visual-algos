import type { AiProvider, Settings } from "@shared/types";
import * as gemini from "./gemini";
import * as openrouter from "./openrouter";
import type { GeneratedSpec } from "./manimPrompt";

/** The resolved provider/key/model actually used for one pipeline run. */
export interface LlmConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

/**
 * Pick the configured provider and make sure it's usable. Throws a message the
 * UI can show verbatim when a key or model is missing.
 */
export function resolveLlm(settings: Settings): LlmConfig {
  if (settings.provider === "openrouter") {
    const apiKey = settings.openRouterApiKey.trim();
    const model = settings.openRouterModel.trim();
    if (!apiKey) throw new Error("No OpenRouter API key set. Add one in Settings.");
    if (!model) throw new Error("No OpenRouter model set. Pick one in Settings.");
    return { provider: "openrouter", apiKey, model };
  }
  const apiKey = settings.geminiApiKey.trim();
  const model = settings.geminiModel.trim();
  if (!apiKey) throw new Error("No Gemini API key set. Add one in Settings.");
  if (!model) throw new Error("No Gemini model set. Pick one in Settings.");
  return { provider: "gemini", apiKey, model };
}

function client(provider: AiProvider) {
  return provider === "openrouter" ? openrouter : gemini;
}

/** Ask the configured provider for a structured algorithm-walkthrough spec. */
export function generateSpec(
  llm: LlmConfig,
  topic: string,
  language: string,
): Promise<GeneratedSpec> {
  return client(llm.provider).generateSpec(llm.apiKey, llm.model, topic, language);
}

/** Ask the configured provider to fix an invalid spec. */
export function repairSpec(
  llm: LlmConfig,
  topic: string,
  language: string,
  error: string,
): Promise<GeneratedSpec> {
  return client(llm.provider).repairSpec(llm.apiKey, llm.model, topic, language, error);
}
