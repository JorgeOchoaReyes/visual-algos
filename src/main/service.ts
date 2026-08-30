import { randomUUID } from "crypto";
import { mkdtempSync, renameSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  ConceptRegister,
  CreateVisualizationInput,
  Mode,
  Orientation,
  RenderQuality,
  VideoLength,
  VideoTheme,
  Visualization,
} from "@shared/types";
import {
  deleteVisualization as storeDelete,
  getSettings,
  getVisualization,
  patchVisualization,
  upsertVisualization,
} from "./store";
import { generateSpec, repairSpec, resolveLlm } from "./llm";
import { validateSpec, vizChangesEnough, type GeneratedSpec } from "./manimPrompt";
import { renderSpec } from "./manim";
import { buildAlignedNarration } from "./narration";
import { muxAudioOntoVideo } from "./av";
import { resolveFfmpegExe, resolvePythonPath } from "./env";
import { getPaths } from "./paths";
import { log } from "./log";

type ChangeListener = (viz: Visualization) => void;
let listener: ChangeListener | null = null;

export function onVisualizationChanged(fn: ChangeListener): void {
  listener = fn;
}
function emit(viz: Visualization | null): void {
  if (viz && listener) listener(viz);
}

const MAX_REPAIRS = 2;
const THEMES: VideoTheme[] = ["8bit", "ink", "slate", "manuscript"];
const LENGTHS: VideoLength[] = ["short", "standard", "deep"];

function norm(input: CreateVisualizationInput) {
  const topic = (input.topic || "").trim();
  const quality: RenderQuality = input.quality === "l" || input.quality === "h" ? input.quality : "m";
  const orientation: Orientation = input.orientation === "portrait" ? "portrait" : "landscape";
  const mode: Mode = input.mode === "concept" ? "concept" : "algorithm";
  const theme: VideoTheme = THEMES.includes(input.theme as VideoTheme) ? (input.theme as VideoTheme) : "8bit";
  const register: ConceptRegister = mode === "concept" && input.register === "glyphs" ? "glyphs" : "free";
  // Length: honor the explicit pick; otherwise portrait (Shorts) defaults to a
  // punchy short and landscape to a standard-length walkthrough.
  const length: VideoLength = LENGTHS.includes(input.length as VideoLength)
    ? (input.length as VideoLength)
    : orientation === "portrait"
      ? "short"
      : "standard";
  // Concept videos show argument lines, not source code — render them plain.
  const language = mode === "concept" ? "text" : (input.language || "python").trim() || "python";
  const narrate = !!input.narrate && !!getSettings().elevenLabsApiKey;
  // Per-video overrides (empty → fall back to the Settings default at run time).
  const model = (input.model || "").trim() || null;
  const voiceId = (input.voiceId || "").trim() || null;
  return { topic, quality, orientation, length, language, narrate, mode, theme, register, model, voiceId };
}

export async function createVisualization(
  input: CreateVisualizationInput,
): Promise<{ id: string }> {
  const { topic, quality, orientation, length, language, narrate, mode, theme, register, model, voiceId } = norm(input);
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
    length,
    model,
    voiceId,
    mode,
    theme,
    register,
    tradition: null,
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

  void runPipeline(viz.id, topic, quality, orientation, length, language, narrate, mode, theme, register, model, voiceId);
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
    existing.length ?? ((existing.orientation ?? "landscape") === "portrait" ? "short" : "standard"),
    existing.language ?? "python",
    narrate,
    existing.mode ?? "algorithm",
    existing.theme ?? "8bit",
    existing.register ?? "free",
    existing.model ?? null,
    existing.voiceId ?? null,
  );
  return { id };
}

async function runPipeline(
  id: string,
  topic: string,
  quality: RenderQuality,
  orientation: Orientation,
  length: VideoLength,
  language: string,
  narrate: boolean,
  mode: Mode,
  theme: VideoTheme,
  register: ConceptRegister,
  model: string | null,
  voiceId: string | null,
): Promise<void> {
  try {
    const llm = resolveLlm(getSettings(), model ?? undefined);
    log.info("pipeline", `start ${id}`, { topic, mode, quality, orientation, length, language, narrate, provider: llm.provider, model: llm.model, voiceId: voiceId ?? "(default)" });

    // 1. Generate the structured spec. Repair once if it's structurally
    //    invalid (a hard failure — can't render). Then, if it's valid but the
    //    visualization barely moves, TRY one repair to enrich it — but keep the
    //    valid original if the repair doesn't land, so we always ship a video.
    let spec = await generateSpec(llm, topic, language, mode, register, length, orientation);
    log.info("pipeline", `${id} spec generated`, { viz: spec.viz, mode: spec.mode, steps: spec.steps.length });
    let check = validateSpec(spec);
    if (!check.ok) {
      log.warn("pipeline", `${id} spec invalid, repairing`, check.reason);
      try {
        const repaired = await repairSpec(llm, topic, language, check.reason || "invalid", mode, register, length, orientation);
        if (validateSpec(repaired).ok) {
          spec = repaired;
          check = { ok: true };
        }
      } catch (e) {
        log.warn("pipeline", `${id} repair failed`, e);
      }
    }
    if (!check.ok) throw new Error(check.reason || "Could not generate a valid walkthrough.");

    if (!vizChangesEnough(spec).ok) {
      try {
        const enriched = await repairSpec(
          llm,
          topic,
          language,
          vizChangesEnough(spec).reason || "thin visualization",
          mode,
          register,
          length,
          orientation,
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

    let note: string | null = null;

    // 2. If narrating, synthesize per-step voice FIRST and stamp each step's
    //    duration onto the spec, so the render times each step to its spoken
    //    line (voice + visuals stay locked). Produces an aligned audio track.
    let narrationTrack: string | null = null;
    const narrationDir = mkdtempSync(join(tmpdir(), "visual-algos-narr-"));
    if (narrate && spec.narration) {
      const prep = await prepareNarration(spec, narrationDir, length, voiceId);
      if (prep.ok) narrationTrack = prep.track!;
      else note = `Narration wasn't added: ${prep.error || "unknown error"}`;
    }

    // 3. Render deterministically; repair+retry on failure.
    log.info("pipeline", `${id} rendering`, { quality, orientation, theme });
    let render = await renderSpec({ id, spec, language, orientation, quality, theme });
    let attempt = 0;
    while (!render.ok && attempt < MAX_REPAIRS) {
      attempt += 1;
      log.warn("pipeline", `${id} render failed (attempt ${attempt}/${MAX_REPAIRS}), repairing`, render.error);
      try {
        const fixed = await repairSpec(llm, topic, language, render.error || "render failed", mode, register, length, orientation);
        if (validateSpec(fixed).ok) {
          spec = fixed;
          applySpec(id, spec);
          // The repaired spec has different steps; rebuild the aligned track.
          if (narrate && spec.narration) {
            const prep = await prepareNarration(spec, narrationDir, length, voiceId);
            narrationTrack = prep.ok ? prep.track! : null;
            if (!prep.ok) note = `Narration wasn't added: ${prep.error || "unknown error"}`;
          }
        }
      } catch {
        break;
      }
      render = await renderSpec({ id, spec, language, orientation, quality, theme });
    }
    if (!render.ok) {
      rmSync(narrationDir, { recursive: true, force: true });
      throw new Error(render.error || "Render failed.");
    }

    // 4. Mux the aligned narration onto the finished video.
    let hasAudio = false;
    if (narrationTrack && render.videoPath) {
      const res = await muxNarration(id, render.videoPath, narrationTrack);
      hasAudio = res.ok;
      if (!res.ok) note = `Narration wasn't added: ${res.error || "unknown error"}`;
    }
    rmSync(narrationDir, { recursive: true, force: true });

    log.info("pipeline", `${id} ready`, { videoPath: render.videoPath, durationSeconds: render.durationSeconds, hasAudio, note });
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
    log.error("pipeline", `${id} generation failed`, err);
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
      tradition: spec.tradition ?? null,
      manimCode: spec.code.join("\n"),
      ...(status ? { status } : {}),
    }),
  );
}

/**
 * Synthesize per-step narration and assemble one aligned track, stamping each
 * step's `dur` onto the spec so the renderer times steps to the voice. Returns
 * the track path (to be muxed after the render).
 */
async function prepareNarration(
  spec: GeneratedSpec,
  workDir: string,
  length: VideoLength = "standard",
  voiceOverride?: string | null,
): Promise<{ ok: boolean; track?: string; error?: string }> {
  try {
    const settings = getSettings();
    if (!settings.elevenLabsApiKey) return { ok: false, error: "no ElevenLabs API key" };
    const python = await resolvePythonPath();
    const ffmpeg = await resolveFfmpegExe(python);
    if (!ffmpeg) return { ok: false, error: "ffmpeg unavailable" };
    const track = join(workDir, "narration.mp3");
    const res = await buildAlignedNarration({
      ffmpegExe: ffmpeg,
      apiKey: settings.elevenLabsApiKey,
      voiceId: (voiceOverride || "").trim() || settings.elevenLabsVoiceId || "21m00Tcm4TlvDq8ikWAM",
      modelId: settings.elevenLabsModel,
      // Shorts get a more expressive, higher-energy delivery to match the
      // snappy script.
      energetic: length === "short",
      steps: spec.steps,
      workDir,
      outPath: track,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, track };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : "narration error" };
  }
}

/** Mux the aligned narration track onto the finished video, in place. */
async function muxNarration(
  id: string,
  videoPath: string,
  audioPath: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const python = await resolvePythonPath();
    const ffmpeg = await resolveFfmpegExe(python);
    if (!ffmpeg) return { ok: false, error: "ffmpeg unavailable" };
    const tmpOut = join(getPaths().videosDir, `${id}.muxed.mp4`);
    const mux = await muxAudioOntoVideo({ ffmpegExe: ffmpeg, videoPath, audioPath, outPath: tmpOut });
    if (!mux.ok) {
      rmSync(tmpOut, { force: true });
      return { ok: false, error: mux.error ? mux.error.slice(0, 160) : "audio mux failed" };
    }
    renameSync(tmpOut, videoPath);
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
