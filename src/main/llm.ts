import type { AiProvider, ConceptRegister, Mode, Orientation, Settings, VideoLength } from "@shared/types";
import * as gemini from "./gemini";
import * as openrouter from "./openrouter";
import type { GeneratedSpec } from "./manimPrompt";
import { log } from "./log";

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
export function resolveLlm(settings: Settings, modelOverride?: string): LlmConfig {
  const override = (modelOverride || "").trim();
  if (settings.provider === "openrouter") {
    const apiKey = settings.openRouterApiKey.trim();
    const model = override || settings.openRouterModel.trim();
    if (!apiKey) throw new Error("No OpenRouter API key set. Add one in Settings.");
    if (!model) throw new Error("No OpenRouter model set. Pick one in Settings.");
    return { provider: "openrouter", apiKey, model };
  }
  const apiKey = settings.geminiApiKey.trim();
  const model = override || settings.geminiModel.trim();
  if (!apiKey) throw new Error("No Gemini API key set. Add one in Settings.");
  if (!model) throw new Error("No Gemini model set. Pick one in Settings.");
  return { provider: "gemini", apiKey, model };
}

function client(provider: AiProvider) {
  return provider === "openrouter" ? openrouter : gemini;
}

/** Ask the configured provider for a structured walkthrough/concept spec. */
export async function generateSpec(
  llm: LlmConfig,
  topic: string,
  language: string,
  mode: Mode,
  register: ConceptRegister,
  length: VideoLength = "standard",
  orientation: Orientation = "landscape",
): Promise<GeneratedSpec> {
  log.info("llm", `generate via ${llm.provider}/${llm.model}`, { mode, register, length, orientation });
  try {
    return await client(llm.provider).generateSpec(llm.apiKey, llm.model, topic, language, mode, register, length, orientation);
  } catch (err) {
    log.error("llm", `generate failed (${llm.provider}/${llm.model})`, err);
    throw err;
  }
}

/** Ask the configured provider to fix an invalid spec. */
export async function repairSpec(
  llm: LlmConfig,
  topic: string,
  language: string,
  error: string,
  mode: Mode,
  register: ConceptRegister,
  length: VideoLength = "standard",
  orientation: Orientation = "landscape",
): Promise<GeneratedSpec> {
  log.info("llm", `repair via ${llm.provider}/${llm.model}`, { reason: error.slice(0, 120), length });
  try {
    return await client(llm.provider).repairSpec(llm.apiKey, llm.model, topic, language, error, mode, register, length, orientation);
  } catch (err) {
    log.error("llm", `repair failed (${llm.provider}/${llm.model})`, err);
    throw err;
  }
}
