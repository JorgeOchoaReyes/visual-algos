import { execFile } from "child_process";

function run(
  cmd: string,
  args: string[],
  timeout = 120000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
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

async function duration(ffmpegExe: string, file: string): Promise<number | null> {
  const res = await run(ffmpegExe, ["-i", file], 30000);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(res.stderr || res.stdout);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Mux an audio track onto a video. If the narration is longer than the video,
 * the last video frame is held (tpad) so the audio isn't cut off. Re-encodes to
 * H.264/AAC for broad compatibility. Returns true on success.
 */
export async function muxAudioOntoVideo(params: {
  ffmpegExe: string;
  videoPath: string;
  audioPath: string;
  outPath: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { ffmpegExe, videoPath, audioPath, outPath } = params;

  const [vDur, aDur] = await Promise.all([
    duration(ffmpegExe, videoPath),
    duration(ffmpegExe, audioPath),
  ]);

  const pad = vDur != null && aDur != null && aDur > vDur ? aDur - vDur + 0.3 : 0;

  const args = ["-y", "-i", videoPath, "-i", audioPath];
  if (pad > 0) {
    args.push(
      "-filter_complex",
      `[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}[v]`,
      "-map",
      "[v]",
      "-map",
      "1:a:0",
    );
  } else {
    args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
  }
  args.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outPath,
  );

  const res = await run(ffmpegExe, args, 180000);
  if (res.code !== 0) {
    return { ok: false, error: (res.stderr || res.stdout).slice(-800) };
  }
  return { ok: true };
}
