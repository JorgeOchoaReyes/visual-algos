import {
  SCHEMA_HINT,
  SYSTEM_INSTRUCTION,
  buildRepairPrompt,
  buildUserPrompt,
  normalizeSpec,
  type GeneratedSpec,
} from "./manimPrompt";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
// OpenRouter uses these purely for attribution on its dashboards.
const APP_URL = "https://github.com/JorgeOchoaReyes/visual-algos";
const APP_TITLE = "Visual Algos";

type MessageContent = string | { text?: string }[] | undefined;

interface ChatResponse {
  choices?: { message?: { content?: MessageContent } }[];
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

/**
 * Models vary in how literally they obey "return only JSON" — some wrap it in a
 * ```json fence or add a sentence around it. Pull out the JSON object.
 */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body;
}

async function chat(
  apiKey: string,
  modelName: string,
  userPrompt: string,
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
      messages: [
        { role: "system", content: `${SYSTEM_INSTRUCTION}\n\n${SCHEMA_HINT}` },
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
      return chat(apiKey, modelName, userPrompt, false);
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

  const content = contentToText(body.choices?.[0]?.message?.content);
  if (!content.trim()) {
    throw new Error(`OpenRouter returned an empty response from ${modelName}.`);
  }
  return content;
}

function parse(text: string, topic: string): GeneratedSpec {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The model returned malformed JSON.");
  }
  return normalizeSpec(raw, topic);
}

/** Ask an OpenRouter model for a structured algorithm-walkthrough spec. */
export async function generateSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
): Promise<GeneratedSpec> {
  return parse(await chat(apiKey, modelName, buildUserPrompt(topic, language)), topic);
}

/** Ask an OpenRouter model to fix an invalid spec. */
export async function repairSpec(
  apiKey: string,
  modelName: string,
  topic: string,
  language: string,
  error: string,
): Promise<GeneratedSpec> {
  return parse(
    await chat(apiKey, modelName, buildRepairPrompt(topic, language, error)),
    topic,
  );
}
