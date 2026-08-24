import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getPaths } from "./paths";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const VOICES_URL = "https://api.elevenlabs.io/v1/voices";

/**
 * Synthesize narration to an MP3 file via the ElevenLabs REST API and write it
 * to `outPath`. Throws with a readable message on failure.
 */
export async function synthesizeNarration(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  outPath: string;
  modelId?: string;
}): Promise<void> {
  const { apiKey, voiceId, text, outPath, modelId } = params;
  const url = `${API_BASE}/${encodeURIComponent(voiceId)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId || "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `ElevenLabs error ${res.status}: ${detail.slice(0, 300) || res.statusText}`,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new Error("ElevenLabs returned an empty audio file.");
  await writeFile(outPath, buf);
}

/**
 * Fetch (and cache on disk) a voice's public preview clip, returned as a data
 * URL the renderer can hand straight to an <audio> element.
 */
export async function voiceSample(params: {
  apiKey: string;
  voiceId: string;
}): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  const { apiKey, voiceId } = params;
  if (!apiKey) return { ok: false, error: "Add an ElevenLabs API key first." };
  if (!voiceId) return { ok: false, error: "Pick a voice first." };

  const dir = join(getPaths().userData, "voice-samples");
  const file = join(dir, `${voiceId.replace(/[^a-zA-Z0-9_-]/g, "")}.mp3`);

  if (!existsSync(file)) {
    // The per-voice endpoint resolves ANY accessible voice id (the shared
    // premade voices in our dropdown are not in the account's voice list).
    const res = await fetch(`${VOICES_URL}/${encodeURIComponent(voiceId)}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: res.status === 400 || res.status === 404
          ? "Unknown voice id."
          : `ElevenLabs error ${res.status}: ${res.statusText}`,
      };
    }
    const voice = (await res.json()) as { preview_url?: string };
    if (!voice.preview_url) {
      return { ok: false, error: "No preview is available for this voice." };
    }
    const clip = await fetch(voice.preview_url);
    if (!clip.ok) return { ok: false, error: `Preview download failed (${clip.status}).` };
    const buf = Buffer.from(await clip.arrayBuffer());
    if (buf.length < 256) return { ok: false, error: "Preview clip was empty." };
    await mkdir(dir, { recursive: true });
    await writeFile(file, buf);
  }

  const data = await readFile(file);
  return { ok: true, dataUrl: `data:audio/mpeg;base64,${data.toString("base64")}` };
}
