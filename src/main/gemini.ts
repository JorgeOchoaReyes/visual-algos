import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  RESPONSE_SCHEMA,
  SCHEMA_CAST,
  SYSTEM_INSTRUCTION,
  buildRepairPrompt,
  buildUserPrompt,
  normalizeSpec,
  type GeneratedSpec,
} from "./manimPrompt";

void RESPONSE_SCHEMA;

function model(apiKey: string, modelName: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.5,
      responseMimeType: "application/json",
      responseSchema: SCHEMA_CAST,
      // A full walkthrough spec (complete code + many richly-detailed steps) is
      // large; without a high ceiling the JSON gets truncated mid-object and
      // fails to parse. Give it plenty of room.
      maxOutputTokens: 16384,
    },
  });
}

/** Pull a JSON object out of a model response, tolerating fences / stray prose. */
function extractJson(text: string): string {
  let t = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
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
