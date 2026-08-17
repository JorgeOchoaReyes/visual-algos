import { randomUUID } from "crypto";
import { renameSync, rmSync } from "fs";
import { join } from "path";
import type { CreateVisualizationInput, Visualization } from "@shared/types";
import {
  deleteVisualization as storeDelete,
  getSettings,
  getVisualization,
  patchVisualization,
  upsertVisualization,
} from "./store";
import { generateManimScene, repairManimScene } from "./gemini";
import { validateManimCode, type GeneratedScene } from "./manimPrompt";
import { renderScene } from "./manim";
import { synthesizeNarration } from "./elevenlabs";
import { muxAudioOntoVideo } from "./av";
import { resolveFfmpegExe, resolvePythonPath } from "./env";
import { getPaths } from "./paths";

type ChangeListener = (viz: Visualization) => void;
let listener: ChangeListener | null = null;

/** Register the function used to push doc updates to the renderer. */
export function onVisualizationChanged(fn: ChangeListener): void {
  listener = fn;
}

function emit(viz: Visualization | null): void {
  if (viz && listener) listener(viz);
}

const MAX_REPAIRS = 2;

export async function createVisualization(
  input: CreateVisualizationInput,
): Promise<{ id: string }> {
  const topic = (input.topic || "").trim();
  if (topic.length < 3) throw new Error("Please enter a longer topic.");
  const quality = input.quality === "l" || input.quality === "h" ? input.quality : "m";
  const narrate = !!input.narrate && !!getSettings().elevenLabsApiKey;

  const now = Date.now();
  const viz: Visualization = {
    id: randomUUID(),
    topic,
    title: topic,
    description: "",
    status: "generating",
    quality,
    manimCode: null,
    sceneName: null,
    videoPath: null,
    durationSeconds: null,
    narration: null,
    narrate,
    hasAudio: false,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  upsertVisualization(viz);
  emit(viz);

  void runPipeline(viz.id, topic, quality, narrate);
  return { id: viz.id };
}

/**
 * Re-run the whole pipeline for an existing visualization (same topic/quality/
 * narration). Useful to retry after an error or just to get a fresh take.
 */
export async function regenerateVisualization(id: string): Promise<{ id: string }> {
  const existing = getVisualization(id);
  if (!existing) throw new Error("Visualization not found.");
  const narrate = !!existing.narrate && !!getSettings().elevenLabsApiKey;

  emit(
    patchVisualization(id, {
      status: "generating",
      error: null,
      manimCode: null,
      sceneName: null,
      videoPath: null,
      narration: null,
      hasAudio: false,
    }),
  );

  void runPipeline(id, existing.topic, existing.quality, narrate);
  return { id };
}

async function runPipeline(
  id: string,
  topic: string,
  quality: "l" | "m" | "h",
  narrate: boolean,
): Promise<void> {
  try {
    const settings = getSettings();
    if (!settings.geminiApiKey) throw new Error("No Gemini API key set. Add one in Settings.");
    const { geminiApiKey: key, geminiModel: model } = settings;

    // 1. Generate the scene.
    let scene = await generateManimScene(key, model, topic);
    let check = validateManimCode(scene);
    if (!check.ok) throw new Error(check.reason || "Generated code failed validation.");

    emit(
      patchVisualization(id, {
        title: scene.title,
        description: scene.description,
        sceneName: scene.sceneName,
        manimCode: scene.code,
        narration: scene.narration || null,
        status: "rendering",
      }),
    );

    // 2. Render, repairing the code with Gemini if it fails.
    let render = await renderScene({
      id,
      code: scene.code,
      sceneName: scene.sceneName,
      quality,
    });

    let attempt = 0;
    while (!render.ok && attempt < MAX_REPAIRS) {
      attempt += 1;
      const repaired = await tryRepair(key, model, topic, scene, render.error || "");
      if (!repaired) break;
      scene = repaired;
      emit(
        patchVisualization(id, {
          title: scene.title,
          description: scene.description,
          sceneName: scene.sceneName,
          manimCode: scene.code,
          narration: scene.narration || null,
        }),
      );
      render = await renderScene({
        id,
        code: scene.code,
        sceneName: scene.sceneName,
        quality,
      });
    }

    if (!render.ok) throw new Error(render.error || "Render failed.");

    // 3. Optional narration: synth via ElevenLabs and mux onto the video.
    let hasAudio = false;
    let duration = render.durationSeconds ?? null;
    if (narrate && scene.narration && render.videoPath) {
      const result = await addNarration(id, scene.narration, render.videoPath);
      hasAudio = result.ok;
      // Narration failure is non-fatal — we keep the silent video.
    }

    emit(
      patchVisualization(id, {
        status: "ready",
        videoPath: render.videoPath ?? null,
        durationSeconds: duration,
        hasAudio,
        error: null,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    emit(patchVisualization(id, { status: "error", error: message }));
  }
}

async function tryRepair(
  key: string,
  model: string,
  topic: string,
  scene: GeneratedScene,
  errorText: string,
): Promise<GeneratedScene | null> {
  try {
    const fixed = await repairManimScene(key, model, topic, scene.code, errorText);
    const check = validateManimCode(fixed);
    if (!check.ok) return null;
    return fixed;
  } catch {
    return null;
  }
}

/** Synthesize narration and mux it onto the rendered video (in place). */
async function addNarration(
  id: string,
  narration: string,
  videoPath: string,
): Promise<{ ok: boolean }> {
  try {
    const settings = getSettings();
    const python = await resolvePythonPath();
    const ffmpeg = await resolveFfmpegExe(python);
    if (!ffmpeg) return { ok: false };

    const { videosDir } = getPaths();
    const audioPath = join(videosDir, `${id}.mp3`);
    const tmpOut = join(videosDir, `${id}.muxed.mp4`);

    await synthesizeNarration({
      apiKey: settings.elevenLabsApiKey,
      voiceId: settings.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM",
      text: narration,
      outPath: audioPath,
    });

    const mux = await muxAudioOntoVideo({ ffmpegExe: ffmpeg, videoPath, audioPath, outPath: tmpOut });
    if (!mux.ok) {
      rmSync(tmpOut, { force: true });
      rmSync(audioPath, { force: true });
      return { ok: false };
    }

    renameSync(tmpOut, videoPath); // replace silent video with narrated one
    rmSync(audioPath, { force: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function deleteVisualizationAndVideo(id: string): void {
  const viz = getVisualization(id);
  const { videoFile, videosDir } = getPaths();
  const candidates = [
    viz?.videoPath,
    videoFile(id),
    join(videosDir, `${id}.mp3`),
    join(videosDir, `${id}.muxed.mp4`),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
  storeDelete(id);
}
