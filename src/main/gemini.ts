import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  SCHEMA_CAST,
  SYSTEM_INSTRUCTION,
  buildRepairPrompt,
  buildUserPrompt,
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
    },
  });
}

function parse(text: string, topic: string): GeneratedSpec {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
  return normalizeSpec(raw, topic);
}

/** Ask Gemini for a structured algorithm-walkthrough spec. */
export async function generateSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
): Promise<GeneratedSpec> {
  const res = await model(apiKey, modelName).generateContent(buildUserPrompt(topic, language));
  return parse(res.response.text(), topic);
}

/** Ask Gemini to fix an invalid spec. */
export async function repairSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
  error: string,
): Promise<GeneratedSpec> {
  const res = await model(apiKey, modelName).generateContent(
    buildRepairPrompt(topic, language, error),
  );
  return parse(res.response.text(), topic);
}
