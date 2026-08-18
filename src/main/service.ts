import { randomUUID } from "crypto";
import { renameSync, rmSync } from "fs";
import { join } from "path";
import type {
  CreateVisualizationInput,
  Orientation,
  RenderQuality,
  Visualization,
} from "@shared/types";
import {
  deleteVisualization as storeDelete,
  getSettings,
  getVisualization,
  patchVisualization,
  upsertVisualization,
} from "./store";
import { generateSpec, repairSpec } from "./gemini";
import { validateSpec, vizChangesEnough, type GeneratedSpec } from "./manimPrompt";
import { renderSpec } from "./manim";
import { synthesizeNarration } from "./elevenlabs";
import { muxAudioOntoVideo } from "./av";
import { resolveFfmpegExe, resolvePythonPath } from "./env";
import { getPaths } from "./paths";

type ChangeListener = (viz: Visualization) => void;
let listener: ChangeListener | null = null;

export function onVisualizationChanged(fn: ChangeListener): void {
  listener = fn;
}
function emit(viz: Visualization | null): void {
  if (viz && listener) listener(viz);
}

const MAX_REPAIRS = 2;
const THEME = "8bit";

function norm(input: CreateVisualizationInput) {
  const topic = (input.topic || "").trim();
  const quality: RenderQuality = input.quality === "l" || input.quality === "h" ? input.quality : "m";
  const orientation: Orientation = input.orientation === "portrait" ? "portrait" : "landscape";
  const language = (input.language || "python").trim() || "python";
  const narrate = !!input.narrate && !!getSettings().elevenLabsApiKey;
  return { topic, quality, orientation, language, narrate };
}

export async function createVisualization(
  input: CreateVisualizationInput,
): Promise<{ id: string }> {
  const { topic, quality, orientation, language, narrate } = norm(input);
  if (topic.length < 3) throw new Error("Please enter a longer topic.");

  const now = Date.now();
  const viz: Visualization = {
    id: randomUUID(),
    topic,
    title: topic,
    description: "",
    status: "generating",
    quality,
    language,
    orientation,
    manimCode: null,
    sceneName: null,
    videoPath: null,
    durationSeconds: null,
    narration: null,
    narrate,
    hasAudio: false,
    note: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  upsertVisualization(viz);
  emit(viz);

  void runPipeline(viz.id, topic, quality, orientation, language, narrate);
  return { id: viz.id };
}

export async function regenerateVisualization(id: string): Promise<{ id: string }> {
  const existing = getVisualization(id);
  if (!existing) throw new Error("Visualization not found.");
  const narrate = !!existing.narrate && !!getSettings().elevenLabsApiKey;
  emit(
    patchVisualization(id, {
      status: "generating",
      error: null,
      manimCode: null,
      videoPath: null,
      narration: null,
      hasAudio: false,
    }),
  );
  void runPipeline(
    id,
    existing.topic,
    existing.quality,
    existing.orientation ?? "landscape",
    existing.language ?? "python",
    narrate,
  );
  return { id };
}

async function runPipeline(
  id: string,
  topic: string,
  quality: RenderQuality,
  orientation: Orientation,
  language: string,
  narrate: boolean,
): Promise<void> {
  try {
    const settings = getSettings();
    if (!settings.geminiApiKey) throw new Error("No Gemini API key set. Add one in Settings.");
    const { geminiApiKey: key, geminiModel: model } = settings;

    // 1. Generate the structured spec. Repair once if it's structurally
    //    invalid (a hard failure — can't render). Then, if it's valid but the
    //    visualization barely moves, TRY one repair to enrich it — but keep the
    //    valid original if the repair doesn't land, so we always ship a video.
    let spec = await generateSpec(key, model, topic, language);
    let check = validateSpec(spec);
    if (!check.ok) {
      try {
        const repaired = await repairSpec(key, model, topic, language, check.reason || "invalid");
        if (validateSpec(repaired).ok) {
          spec = repaired;
          check = { ok: true };
        }
      } catch {
        /* keep original error */
      }
    }
    if (!check.ok) throw new Error(check.reason || "Could not generate a valid walkthrough.");

    if (!vizChangesEnough(spec).ok) {
      try {
        const enriched = await repairSpec(
          key,
          model,
          topic,
          language,
          vizChangesEnough(spec).reason || "thin visualization",
        );
        // Only adopt the enriched spec if it's structurally sound AND actually
        // improves the visualization; otherwise render the original as-is.
        if (validateSpec(enriched).ok && vizChangesEnough(enriched).ok) {
          spec = enriched;
        }
      } catch {
        /* render the original valid spec */
      }
    }

    applySpec(id, spec, "rendering");

    // 2. Render deterministically; repair+retry on failure.
    let render = await renderSpec({ id, spec, language, orientation, quality, theme: THEME });
    let attempt = 0;
    while (!render.ok && attempt < MAX_REPAIRS) {
      attempt += 1;
      try {
        const fixed = await repairSpec(key, model, topic, language, render.error || "render failed");
        if (validateSpec(fixed).ok) {
          spec = fixed;
          applySpec(id, spec);
        }
      } catch {
        break;
      }
      render = await renderSpec({ id, spec, language, orientation, quality, theme: THEME });
    }
    if (!render.ok) throw new Error(render.error || "Render failed.");

    // 3. Optional narration.
    let hasAudio = false;
    let note: string | null = null;
    if (narrate && spec.narration && render.videoPath) {
      const res = await addNarration(id, spec.narration, render.videoPath);
      hasAudio = res.ok;
      if (!res.ok) note = `Narration wasn't added: ${res.error || "unknown error"}`;
    }

    emit(
      patchVisualization(id, {
        status: "ready",
        videoPath: render.videoPath ?? null,
        durationSeconds: render.durationSeconds ?? null,
        hasAudio,
        note,
        error: null,
      }),
    );
  } catch (err) {
    emit(
      patchVisualization(id, {
        status: "error",
        error: err instanceof Error ? err.message : "Generation failed.",
      }),
    );
  }
}

function applySpec(id: string, spec: GeneratedSpec, status?: "rendering"): void {
  emit(
    patchVisualization(id, {
      title: spec.title,
      description: spec.description,
      narration: spec.narration || null,
      manimCode: spec.code.join("\n"),
      ...(status ? { status } : {}),
    }),
  );
}

async function addNarration(
  id: string,
  narration: string,
  videoPath: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = getSettings();
    if (!settings.elevenLabsApiKey) return { ok: false, error: "no ElevenLabs API key" };
    const python = await resolvePythonPath();
    const ffmpeg = await resolveFfmpegExe(python);
    if (!ffmpeg) return { ok: false, error: "ffmpeg unavailable" };
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
      return { ok: false, error: mux.error ? mux.error.slice(0, 160) : "audio mux failed" };
    }
    renameSync(tmpOut, videoPath);
    rmSync(audioPath, { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : "narration error" };
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
