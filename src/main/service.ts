import { randomUUID } from "crypto";
import { rmSync } from "fs";
import type { CreateVisualizationInput, Visualization } from "@shared/types";
import {
  deleteVisualization as storeDelete,
  getSettings,
  getVisualization,
  patchVisualization,
  upsertVisualization,
} from "./store";
import { generateManimScene } from "./gemini";
import { validateManimCode } from "./manimPrompt";
import { renderScene } from "./manim";
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

/**
 * Create a new visualization and start the generate→render pipeline. Returns the
 * id immediately; progress is reported via change events as the job advances.
 */
export async function createVisualization(
  input: CreateVisualizationInput,
): Promise<{ id: string }> {
  const topic = (input.topic || "").trim();
  if (topic.length < 3) throw new Error("Please enter a longer topic.");
  const quality = input.quality === "l" || input.quality === "h" ? input.quality : "m";

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
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  upsertVisualization(viz);
  emit(viz);

  // Fire-and-forget: run the pipeline in the background.
  void runPipeline(viz.id, topic, quality);

  return { id: viz.id };
}

async function runPipeline(id: string, topic: string, quality: "l" | "m" | "h"): Promise<void> {
  try {
    const settings = getSettings();
    if (!settings.geminiApiKey) {
      throw new Error("No Gemini API key set. Add one in Settings.");
    }

    // 1. Generate the scene with Gemini.
    const scene = await generateManimScene(settings.geminiApiKey, settings.geminiModel, topic);

    // 2. Safety scan.
    const check = validateManimCode(scene);
    if (!check.ok) throw new Error(check.reason || "Generated code failed validation.");

    emit(
      patchVisualization(id, {
        title: scene.title,
        description: scene.description,
        sceneName: scene.sceneName,
        manimCode: scene.code,
        status: "rendering",
      }),
    );

    // 3. Render locally with manim.
    const result = await renderScene({
      id,
      code: scene.code,
      sceneName: scene.sceneName,
      quality,
    });

    if (!result.ok) throw new Error(result.error || "Render failed.");

    emit(
      patchVisualization(id, {
        status: "ready",
        videoPath: result.videoPath ?? null,
        durationSeconds: result.durationSeconds ?? null,
        error: null,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    emit(patchVisualization(id, { status: "error", error: message }));
  }
}

export function deleteVisualizationAndVideo(id: string): void {
  const viz = getVisualization(id);
  if (viz?.videoPath) {
    try {
      rmSync(viz.videoPath, { force: true });
    } catch {
      /* ignore */
    }
  } else {
    // Also try the conventional path in case videoPath wasn't recorded.
    try {
      rmSync(getPaths().videoFile(id), { force: true });
    } catch {
      /* ignore */
    }
  }
  storeDelete(id);
}
