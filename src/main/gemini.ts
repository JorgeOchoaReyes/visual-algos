import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  MAX_OUTPUT_TOKENS,
  SCHEMA_CAST,
  SYSTEM_INSTRUCTION,
  buildRepairPrompt,
  buildUserPrompt,
  extractJson,
  normalizeSpec,
  type GeneratedSpec,
} from "./manimPrompt";

function model(apiKey: string, modelName: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.5,
      responseMimeType: "application/json",
      responseSchema: SCHEMA_CAST,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });
}

function parse(text: string, topic: string): GeneratedSpec {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
  return normalizeSpec(raw, topic);
}

/**
 * Run one generation and return its text, surfacing a clear reason when the
 * model stops early (safety block, or MAX_TOKENS truncation) instead of a bare
 * parse failure.
 */
async function generate(apiKey: string, modelName: string, prompt: string): Promise<string> {
  const res = await model(apiKey, modelName).generateContent(prompt);
  const reason = res.response.candidates?.[0]?.finishReason;
  if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
    throw new Error(`Gemini stopped early (${reason}). Try a different topic or model.`);
  }
  let text = "";
  try {
    text = res.response.text();
  } catch {
    text = "";
  }
  if (reason === "MAX_TOKENS" && !text.trim().endsWith("}")) {
    throw new Error("Gemini's response was cut off (too long). Try a simpler topic or the Flash model.");
  }
  return text;
}

/** Generate + parse, retrying once on a malformed/empty response. */
async function generateAndParse(
  apiKey: string,
  modelName: string,
  prompt: string,
  topic: string,
): Promise<GeneratedSpec> {
  try {
    return parse(await generate(apiKey, modelName, prompt), topic);
  } catch (first) {
    try {
      return parse(await generate(apiKey, modelName, prompt), topic);
    } catch {
      throw first instanceof Error ? first : new Error("Gemini returned malformed JSON.");
    }
  }
}

/** Ask Gemini for a structured algorithm-walkthrough spec. */
export async function generateSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
): Promise<GeneratedSpec> {
  return generateAndParse(apiKey, modelName, buildUserPrompt(topic, language), topic);
}

/** Ask Gemini to fix an invalid spec. */
export async function repairSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
  error: string,
): Promise<GeneratedSpec> {
  return generateAndParse(apiKey, modelName, buildRepairPrompt(topic, language, error), topic);
}
