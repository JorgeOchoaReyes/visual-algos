import type { Mode } from "@shared/types";
import {
  MAX_OUTPUT_TOKENS,
  buildRepairPrompt,
  buildUserPrompt,
  extractJson,
  normalizeSpec,
  promptFor,
  schemaHintFor,
  type GeneratedSpec,
} from "./manimPrompt";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
// OpenRouter uses these purely for attribution on its dashboards.
const APP_URL = "https://github.com/JorgeOchoaReyes/visual-algos";
const APP_TITLE = "Visual Algos";

type MessageContent = string | { text?: string }[] | undefined;

interface ChatResponse {
  choices?: { message?: { content?: MessageContent }; finish_reason?: string }[];
  error?: { message?: string };
}

/** OpenRouter returns errors both as HTTP status bodies and as 200 payloads. */
function errorMessage(text: string): string {
  try {
    const body = JSON.parse(text) as ChatResponse;
    if (body.error?.message) return body.error.message;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return text.slice(0, 300);
}

/** Some providers hand back content as parts rather than a plain string. */
function contentToText(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p?.text ?? "").join("");
  return "";
}

async function chat(
  apiKey: string,
  modelName: string,
  userPrompt: string,
  mode: Mode,
  jsonMode = true,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "HTTP-Referer": APP_URL,
      "X-Title": APP_TITLE,
    },
    body: JSON.stringify({
      model: modelName,
      temperature: 0.5,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: `${promptFor(mode)}\n\n${schemaHintFor(mode)}` },
        { role: "user", content: userPrompt },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    // Not every model accepts response_format; retry once without it before
    // giving up, since the prompt already asks for JSON.
    if (jsonMode && res.status === 400 && /response_format|json/i.test(text)) {
      return chat(apiKey, modelName, userPrompt, mode, false);
    }
    throw new Error(`OpenRouter error ${res.status}: ${errorMessage(text) || res.statusText}`);
  }

  let body: ChatResponse;
  try {
    body = JSON.parse(text) as ChatResponse;
  } catch {
    throw new Error("OpenRouter returned a malformed response.");
  }
  if (body.error?.message) throw new Error(`OpenRouter error: ${body.error.message}`);

  const choice = body.choices?.[0];
  const content = contentToText(choice?.message?.content);
  if (!content.trim()) {
    throw new Error(`OpenRouter returned an empty response from ${modelName}.`);
  }
  // "length" means the spec was cut off mid-JSON; say so rather than letting it
  // surface as an opaque parse failure.
  if (choice?.finish_reason === "length" && !content.trim().endsWith("}")) {
    throw new Error(
      "The response was cut off (too long). Try a simpler topic or a model with a larger output limit.",
    );
  }
  return content;
}

function parse(text: string, topic: string, mode: Mode): GeneratedSpec {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The model returned malformed JSON.");
  }
  return normalizeSpec(raw, topic, mode);
}

/** Generate + parse, retrying once on a malformed/empty response. */
async function chatAndParse(
  apiKey: string,
  modelName: string,
  prompt: string,
  topic: string,
  mode: Mode,
): Promise<GeneratedSpec> {
  try {
    return parse(await chat(apiKey, modelName, prompt, mode), topic, mode);
  } catch (first) {
    try {
      return parse(await chat(apiKey, modelName, prompt, mode), topic, mode);
    } catch {
      throw first instanceof Error ? first : new Error("The model returned malformed JSON.");
    }
  }
}

/** Ask an OpenRouter model for a structured walkthrough/concept spec. */
export async function generateSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
  mode: Mode,
): Promise<GeneratedSpec> {
  return chatAndParse(apiKey, modelName, buildUserPrompt(topic, language, mode), topic, mode);
}

/** Ask an OpenRouter model to fix an invalid spec. */
export async function repairSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
  error: string,
  mode: Mode,
): Promise<GeneratedSpec> {
  return chatAndParse(apiKey, modelName, buildRepairPrompt(topic, language, error, mode), topic, mode);
}
