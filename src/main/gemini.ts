import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import {
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  buildRepairPrompt,
  buildUserPrompt,
  type GeneratedScene,
} from "./manimPrompt";

function client(apiKey: string, model: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA as unknown as { type: SchemaType },
    },
  });
}

function parseScene(text: string, topic: string): GeneratedScene {
  let parsed: GeneratedScene;
  try {
    parsed = JSON.parse(text) as GeneratedScene;
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
  if (!parsed || typeof parsed.code !== "string" || typeof parsed.sceneName !== "string") {
    throw new Error("Gemini response was missing required fields.");
  }
  return {
    title: (parsed.title || topic).slice(0, 120),
    description: (parsed.description || "").slice(0, 600),
    sceneName: parsed.sceneName.trim(),
    code: parsed.code,
    narration: typeof parsed.narration === "string" ? parsed.narration.slice(0, 1200) : "",
  };
}

/** Ask Gemini to write a Manim scene for the given topic. Throws on failure. */
export async function generateManimScene(
  apiKey: string,
  model: string,
  topic: string,
): Promise<GeneratedScene> {
  const result = await client(apiKey, model).generateContent(buildUserPrompt(topic));
  return parseScene(result.response.text(), topic);
}

/**
 * Ask Gemini to fix a scene that failed to render, given the code + traceback.
 */
export async function repairManimScene(
  apiKey: string,
  model: string,
  topic: string,
  code: string,
  errorText: string,
): Promise<GeneratedScene> {
  const result = await client(apiKey, model).generateContent(
    buildRepairPrompt(topic, code, errorText),
  );
  return parseScene(result.response.text(), topic);
}
