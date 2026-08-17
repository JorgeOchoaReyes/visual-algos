import { writeFile } from "fs/promises";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

/**
 * Synthesize narration to an MP3 file via the ElevenLabs REST API and write it
 * to `outPath`. Throws with a readable message on failure.
 */
export async function synthesizeNarration(params: {
  apiKey: string;
  voiceId: string;
  text: string;
  outPath: string;
}): Promise<void> {
  const { apiKey, voiceId, text, outPath } = params;
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
      model_id: "eleven_multilingual_v2",
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
