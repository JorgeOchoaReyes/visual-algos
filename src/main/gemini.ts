import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ConceptRegister, Mode } from "@shared/types";
import {
  MAX_OUTPUT_TOKENS,
  buildRepairPrompt,
  buildUserPrompt,
  extractJson,
  normalizeSpec,
  promptFor,
  schemaCastFor,
  type GeneratedSpec,
} from "./manimPrompt";

function model(apiKey: string, modelName: string, mode: Mode, register: ConceptRegister) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: promptFor(mode, register),
    generationConfig: {
      temperature: 0.5,
      responseMimeType: "application/json",
      responseSchema: schemaCastFor(mode, register),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });
}

function parse(text: string, topic: string, mode: Mode, register: ConceptRegister): GeneratedSpec {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
  return normalizeSpec(raw, topic, mode, register);
}

/**
 * Run one generation and return its text, surfacing a clear reason when the
 * model stops early (safety block, or MAX_TOKENS truncation) instead of a bare
 * parse failure.
 */
async function generate(apiKey: string, modelName: string, prompt: string, mode: Mode, register: ConceptRegister): Promise<string> {
  const res = await model(apiKey, modelName, mode, register).generateContent(prompt);
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
  mode: Mode,
  register: ConceptRegister,
): Promise<GeneratedSpec> {
  try {
    return parse(await generate(apiKey, modelName, prompt, mode, register), topic, mode, register);
  } catch (first) {
    try {
      return parse(await generate(apiKey, modelName, prompt, mode, register), topic, mode, register);
    } catch {
      throw first instanceof Error ? first : new Error("Gemini returned malformed JSON.");
    }
  }
}

/** Ask Gemini for a structured walkthrough/concept spec. */
export async function generateSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
  mode: Mode,
  register: ConceptRegister,
): Promise<GeneratedSpec> {
  return generateAndParse(apiKey, modelName, buildUserPrompt(topic, language, mode), topic, mode, register);
}

/** Ask Gemini to fix an invalid spec. */
export async function repairSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
  error: string,
  mode: Mode,
  register: ConceptRegister,
): Promise<GeneratedSpec> {
  return generateAndParse(apiKey, modelName, buildRepairPrompt(topic, language, error, mode), topic, mode, register);
}
