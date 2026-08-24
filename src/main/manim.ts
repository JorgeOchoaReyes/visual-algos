import { app } from "electron";
import { execFile } from "child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { GeneratedSpec } from "./manimPrompt";
import type { Orientation, RenderQuality } from "@shared/types";
import { resolveFfmpegExe, resolvePythonPath } from "./env";
import { getPaths } from "./paths";

const QUALITY_FLAG: Record<RenderQuality, string> = { l: "-ql", m: "-qm", h: "-qh" };

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

/** Path to the bundled deterministic renderer template. */
function templatePath(): string | null {
  const base = app.isPackaged
    ? join(process.resourcesPath, "render")
    : join(app.getAppPath(), "resources", "render");
  const p = join(base, "walkthrough.py");
  return existsSync(p) ? p : null;
}

function findMp4s(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...findMp4s(full));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".mp4")) out.push(full);
  }
  return out;
}

async function probeDuration(ffmpegExe: string, file: string): Promise<number | null> {
  const res = await run(ffmpegExe, ["-i", file], { timeout: 20000 });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(res.stderr || res.stdout);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) ? Math.round(seconds * 100) / 100 : null;
}

/**
 * Render a structured walkthrough spec to an MP4 via the bundled Manim template.
 * The AI-produced spec is pure DATA (written to spec.json); the template is our
 * trusted, fixed renderer.
 */
export async function renderSpec(params: {
  id: string;
  spec: GeneratedSpec;
  language: string;
  orientation: Orientation;
  quality: RenderQuality;
  theme?: string;
  timeoutMs?: number;
}): Promise<RenderResult> {
  const { id, spec, language, orientation, quality, theme = "8bit", timeoutMs = 600000 } = params;

  const python = await resolvePythonPath();
  if (!python) return { ok: false, error: "No python interpreter found." };
  const template = templatePath();
  if (!template) return { ok: false, error: "Renderer template not found." };

  const workdir = mkdtempSync(join(tmpdir(), "visual-algos-"));
  try {
    // spec.json consumed by walkthrough.py
    const specJson = {
      title: spec.title,
      language,
      orientation,
      theme,
      viz: spec.viz ?? "array",
      code: spec.code,
      array: spec.array,
      target: spec.target ?? null,
      nodes: spec.nodes ?? [],
      edges: spec.edges ?? [],
      grid: spec.grid ?? [],
      tradition: spec.tradition ?? null,
      actors: spec.actors ?? [],
      zones: spec.zones ?? [],
      links: spec.links ?? [],
      steps: spec.steps,
    };
    writeFileSync(join(workdir, "spec.json"), JSON.stringify(specJson), "utf-8");
    copyFileSync(template, join(workdir, "walkthrough.py"));

    const ffmpegExe = await resolveFfmpegExe(python);
    if (ffmpegExe && ffmpegExe !== "ffmpeg") {
      writeFileSync(join(workdir, "manim.cfg"), `[ffmpeg]\nffmpeg_executable = ${ffmpegExe}\n`, "utf-8");
    }

    const args = [
      "-m", "manim", "render", QUALITY_FLAG[quality],
      "--media_dir", join(workdir, "media"),
      "--format", "mp4",
      join(workdir, "walkthrough.py"), "Walkthrough",
    ];
    const res = await run(python, args, { timeout: timeoutMs, cwd: workdir });
    if (res.code !== 0) {
      const tail = (res.stderr || res.stdout || "").trim().slice(-1200);
      return { ok: false, error: `Render failed:\n${tail}` };
    }

    let mp4s: string[] = [];
    try {
      mp4s = findMp4s(join(workdir, "media"));
    } catch {
      mp4s = [];
    }
    if (mp4s.length === 0) return { ok: false, error: "Render produced no video file." };
    mp4s.sort((a, b) => statSync(b).size - statSync(a).size);
    const chosen = mp4s[0];

    // Copy to the library, adding +faststart (moov atom at the front) so the
    // video seeks/scrubs smoothly when streamed over the media protocol.
    const dest = getPaths().videoFile(id);
    let fastStarted = false;
    if (ffmpegExe) {
      const ff = await run(
        ffmpegExe,
        ["-y", "-i", chosen, "-c", "copy", "-movflags", "+faststart", dest],
        { timeout: 120000 },
      );
      fastStarted = ff.code === 0 && existsSync(dest);
    }
    if (!fastStarted) copyFileSync(chosen, dest);

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
