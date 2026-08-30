import { execFile } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { synthesizeNarration } from "./elevenlabs";
import type { SpecStep } from "./manimPrompt";

/**
 * Per-step narration → a single audio track whose clips line up with the
 * rendered steps, so the voice describes exactly what's on screen.
 *
 * How the timing stays in sync:
 *   - each step's spoken line is synthesized to its own clip;
 *   - we measure each clip and set step.dur = clip length + a small gap;
 *   - the renderer makes that step last exactly step.dur seconds;
 *   - here we build one track: INTRO_SECONDS of silence (matching the renderer's
 *     intro), then each clip padded with trailing silence to fill its step.
 * Because both sides use the same per-step durations and the same intro, the
 * track and the video advance together.
 */

// MUST match INTRO_SECONDS in resources/render/walkthrough.py.
const INTRO_SECONDS = 2.2;
const MIN_STEP = 1.1; // floor so very short lines still read clearly
const GAP = 0.35; // breath between spoken lines
const AR = 44100;

function run(cmd: string, args: string[], timeout = 60000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      resolve({
        code:
          err && typeof (err as { code?: number }).code === "number"
            ? ((err as { code?: number }).code as number)
            : err
              ? 1
              : 0,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
      });
    });
  });
}

function parseDuration(text: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function clipDuration(ffmpegExe: string, file: string): Promise<number | null> {
  const res = await run(ffmpegExe, ["-i", file], 20000);
  return parseDuration(res.stderr || res.stdout);
}

/** Make a mono mp3 of `seconds` of silence at `out`. */
async function silence(ffmpegExe: string, seconds: number, out: string): Promise<boolean> {
  const res = await run(
    ffmpegExe,
    ["-y", "-f", "lavfi", "-t", seconds.toFixed(3), "-i", `anullsrc=r=${AR}:cl=mono`, "-c:a", "libmp3lame", out],
    30000,
  );
  return res.code === 0;
}

/** Pad `clip` with trailing silence so it lasts exactly `seconds`, into `out`. */
async function padTo(ffmpegExe: string, clip: string, seconds: number, out: string): Promise<boolean> {
  const res = await run(
    ffmpegExe,
    ["-y", "-i", clip, "-af", `apad`, "-t", seconds.toFixed(3), "-ar", String(AR), "-ac", "1", "-c:a", "libmp3lame", out],
    60000,
  );
  return res.code === 0;
}

export interface NarrationResult {
  ok: boolean;
  error?: string;
  /** total spoken characters, for logging/estimates */
  chars?: number;
}

/**
 * Synthesize per-step narration and assemble the aligned track at `outPath`.
 * Mutates `steps` in place, setting each step's `dur`. On any failure returns
 * { ok:false } and leaves durs unset (the render then uses estimated timing and
 * ships silent).
 */
export async function buildAlignedNarration(params: {
  ffmpegExe: string;
  apiKey: string;
  voiceId: string;
  modelId?: string;
  /** More expressive, higher-energy delivery (for snappy Shorts). */
  energetic?: boolean;
  steps: SpecStep[];
  workDir: string;
  outPath: string;
}): Promise<NarrationResult> {
  const { ffmpegExe, apiKey, voiceId, modelId, energetic, steps, workDir, outPath } = params;
  try {
    const segFiles: string[] = [];
    let chars = 0;

    // Intro silence so the first spoken line lands when the bars appear.
    const introFile = join(workDir, "seg_intro.mp3");
    if (!(await silence(ffmpegExe, INTRO_SECONDS, introFile))) {
      return { ok: false, error: "could not create intro silence" };
    }
    segFiles.push(introFile);

    for (let i = 0; i < steps.length; i++) {
      const say = (steps[i].say || "").trim();
      const segOut = join(workDir, `seg_${i}.mp3`);
      if (!say) {
        steps[i].dur = MIN_STEP;
        if (!(await silence(ffmpegExe, MIN_STEP, segOut))) {
          return { ok: false, error: `silence seg ${i} failed` };
        }
        segFiles.push(segOut);
        continue;
      }
      chars += say.length;
      const clip = join(workDir, `clip_${i}.mp3`);
      await synthesizeNarration({ apiKey, voiceId, modelId, energetic, text: say, outPath: clip });
      const cd = await clipDuration(ffmpegExe, clip);
      const dur = Math.max(MIN_STEP, (cd ?? MIN_STEP) + GAP);
      steps[i].dur = Math.round(dur * 100) / 100;
      if (!(await padTo(ffmpegExe, clip, steps[i].dur!, segOut))) {
        return { ok: false, error: `pad seg ${i} failed` };
      }
      segFiles.push(segOut);
    }

    // Concatenate all segments into one track.
    const listFile = join(workDir, "concat.txt");
    writeFileSync(
      listFile,
      segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf-8",
    );
    const cat = await run(
      ffmpegExe,
      ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-ar", String(AR), "-ac", "1", "-c:a", "libmp3lame", outPath],
      120000,
    );
    if (cat.code !== 0) {
      return { ok: false, error: (cat.stderr || cat.stdout).slice(-400) };
    }
    return { ok: true, chars };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "narration error" };
  }
}
