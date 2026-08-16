import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import {
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
  type GeneratedScene,
} from "./manimPrompt";

/** Ask Gemini to write a Manim scene for the given topic. Throws on failure. */
export async function generateManimScene(
  apiKey: string,
  model: string,
  topic: string,
): Promise<GeneratedScene> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA as unknown as { type: SchemaType },
    },
  });

  const result = await generativeModel.generateContent(buildUserPrompt(topic));
  const text = result.response.text();

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
  };
}
