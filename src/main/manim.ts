import { execFile } from "child_process";
import { mkdtempSync, rmSync, readdirSync, statSync, copyFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { RenderQuality } from "@shared/types";
import { QUALITY_FLAG } from "./manimPrompt";
import { resolveFfmpegExe, resolvePythonPath } from "./env";
import { getPaths } from "./paths";

export interface RenderResult {
  ok: boolean;
  videoPath?: string;
  durationSeconds?: number | null;
  error?: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { timeout: number; cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeout, cwd: opts.cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 16 },
      (err, stdout, stderr) => {
        resolve({
          code: err && typeof (err as { code?: number }).code === "number"
            ? ((err as { code?: number }).code as number)
            : err
              ? 1
              : 0,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
        });
      },
    );
  });
}

/** Recursively collect .mp4 files under a directory. */
function findMp4s(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findMp4s(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")) out.push(full);
  }
  return out;
}

/**
 * Best-effort duration. imageio-ffmpeg ships ffmpeg but not ffprobe, so we
 * parse the "Duration: HH:MM:SS.xx" line ffmpeg prints to stderr for `-i`.
 */
async function probeDuration(ffmpegExe: string, file: string): Promise<number | null> {
  const res = await run(ffmpegExe, ["-i", file], { timeout: 20000 });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(res.stderr || res.stdout);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) ? Math.round(seconds * 100) / 100 : null;
}

/**
 * Render a Manim scene to an MP4 stored at videos/{id}.mp4.
 * Runs entirely on the local machine via the user's python + manim.
 */
export async function renderScene(params: {
  id: string;
  code: string;
  sceneName: string;
  quality: RenderQuality;
  timeoutMs?: number;
}): Promise<RenderResult> {
  const { id, code, sceneName, quality, timeoutMs = 600000 } = params;

  const python = await resolvePythonPath();
  if (!python) return { ok: false, error: "No python interpreter found." };

  const workdir = mkdtempSync(join(tmpdir(), "visual-algos-"));
  try {
    const scriptPath = join(workdir, "scene.py");
    const mediaDir = join(workdir, "media");
    writeFileSync(scriptPath, code, "utf-8");

    // Point Manim at a concrete ffmpeg (the bundled static binary from
    // imageio-ffmpeg) via a local manim.cfg, so renders need no system ffmpeg.
    const ffmpegExe = await resolveFfmpegExe(python);
    if (ffmpegExe && ffmpegExe !== "ffmpeg") {
      writeFileSync(
        join(workdir, "manim.cfg"),
        `[ffmpeg]\nffmpeg_executable = ${ffmpegExe}\n`,
        "utf-8",
      );
    }

    // Invoke manim as a python module so we don't depend on a console script on PATH.
    const args = [
      "-m",
      "manim",
      "render",
      QUALITY_FLAG[quality],
      "--media_dir",
      mediaDir,
      "--format",
      "mp4",
      scriptPath,
      sceneName,
    ];
    const res = await run(python, args, { timeout: timeoutMs, cwd: workdir });
    if (res.code !== 0) {
      const tail = (res.stderr || res.stdout || "").trim().slice(-1200);
      return { ok: false, error: `Manim render failed:\n${tail}` };
    }

    let mp4s: string[] = [];
    try {
      mp4s = findMp4s(mediaDir);
    } catch {
      mp4s = [];
    }
    if (mp4s.length === 0) return { ok: false, error: "Render produced no video file." };

    // Prefer the file whose name matches the scene; then the largest.
    mp4s.sort((a, b) => {
      const aMatch = a.includes(sceneName) ? 0 : 1;
      const bMatch = b.includes(sceneName) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return statSync(b).size - statSync(a).size;
    });
    const chosen = mp4s[0];

    const { videoFile } = getPaths();
    const dest = videoFile(id);
    copyFileSync(chosen, dest);

    let duration: number | null = null;
    try {
      if (ffmpegExe) duration = await probeDuration(ffmpegExe, dest);
    } catch {
      duration = null;
    }

    return { ok: true, videoPath: dest, durationSeconds: duration };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
