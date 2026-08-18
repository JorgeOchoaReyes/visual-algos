import { app } from "electron";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { platform } from "os";
import type { EnvStatus, ToolStatus } from "@shared/types";
import { getPaths } from "./paths";
import { getSettings } from "./store";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command and capture output; never throws (errors become code !== 0). */
function run(cmd: string, args: string[], timeout = 20000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        code: err && typeof (err as { code?: number }).code === "number"
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

const isWin = platform() === "win32";

/**
 * Path to the Python interpreter inside the runtime bundled with the app
 * (built by scripts/setup-python-runtime.mjs). This is what makes the app
 * "just works" with no user setup. Returns null if not bundled (e.g. a dev
 * build where setup:python hasn't run).
 */
export function bundledPython(): string | null {
  const base = app.isPackaged
    ? join(process.resourcesPath, "pyruntime")
    : join(app.getAppPath(), "resources", "pyruntime");
  const p = isWin ? join(base, "python.exe") : join(base, "bin", "python3");
  return existsSync(p) ? p : null;
}

/** Path to the python inside the app-managed venv, if it exists. */
export function managedVenvPython(): string | null {
  const { venvDir } = getPaths();
  const p = isWin ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
  return existsSync(p) ? p : null;
}

/** Ordered list of python interpreters to try (bundled first — zero setup). */
function pythonCandidates(): string[] {
  const settings = getSettings();
  const list: string[] = [];
  const bundled = bundledPython();
  if (bundled) list.push(bundled);
  const managed = managedVenvPython();
  if (managed) list.push(managed);
  if (settings.pythonPath) list.push(settings.pythonPath);
  list.push("python3", "python");
  return [...new Set(list)];
}

/**
 * Resolve an ffmpeg executable for rendering. Prefers the static binary that
 * ships with imageio-ffmpeg inside the bundled runtime, then a system ffmpeg.
 * Returns null if none is found.
 */
export async function resolveFfmpegExe(pythonPath: string | null): Promise<string | null> {
  if (pythonPath) {
    const bundled = await run(
      pythonPath,
      ["-c", "import imageio_ffmpeg, sys; sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())"],
      10000,
    );
    if (bundled.code === 0 && bundled.stdout.trim() && existsSync(bundled.stdout.trim())) {
      return bundled.stdout.trim();
    }
  }
  const sys = await run("ffmpeg", ["-version"], 8000);
  if (sys.code === 0) return "ffmpeg";
  return null;
}

async function importsManim(py: string): Promise<boolean> {
  const res = await run(py, ["-c", "import manim"], 20000);
  return res.code === 0;
}

/**
 * Resolve the python interpreter to use. Prefer one that can actually import
 * manim (so rendering works); if none can, fall back to the first that runs (so
 * the auto-setup has a base to build a venv from).
 */
export async function resolvePythonPath(): Promise<string | null> {
  let firstRunnable: string | null = null;
  for (const cand of pythonCandidates()) {
    const res = await run(cand, ["--version"], 8000);
    if (res.code !== 0) continue;
    if (firstRunnable === null) firstRunnable = cand;
    if (await importsManim(cand)) return cand;
  }
  return firstRunnable;
}

async function detectPython(): Promise<{ status: ToolStatus; path: string | null }> {
  const path = await resolvePythonPath();
  if (!path) {
    return {
      status: { ok: false, path: null, version: null, detail: "No python interpreter found." },
      path: null,
    };
  }
  const res = await run(path, ["--version"], 8000);
  const version = (res.stdout || res.stderr).trim().replace(/^Python\s*/i, "") || null;
  return { status: { ok: true, path, version }, path };
}

async function detectManim(pythonPath: string | null): Promise<ToolStatus> {
  if (!pythonPath) return { ok: false, path: null, version: null };
  const res = await run(
    pythonPath,
    ["-c", "import manim, sys; sys.stdout.write(manim.__version__)"],
    15000,
  );
  if (res.code === 0 && res.stdout.trim()) {
    return { ok: true, path: pythonPath, version: res.stdout.trim() };
  }
  return {
    ok: false,
    path: null,
    version: null,
    detail: "manim is not importable by this python.",
  };
}

async function detectFfmpeg(pythonPath: string | null): Promise<ToolStatus> {
  // Prefer a system ffmpeg.
  const sys = await run("ffmpeg", ["-version"], 8000);
  if (sys.code === 0) {
    const first = sys.stdout.split("\n")[0]?.trim() ?? "";
    const version = first.replace(/^ffmpeg version\s*/i, "").split(" ")[0] || null;
    return { ok: true, path: "ffmpeg", version, detail: "system ffmpeg" };
  }
  // Manim can fall back to imageio-ffmpeg's bundled binary.
  if (pythonPath) {
    const bundled = await run(
      pythonPath,
      ["-c", "import imageio_ffmpeg, sys; sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())"],
      10000,
    );
    if (bundled.code === 0 && bundled.stdout.trim()) {
      return {
        ok: true,
        path: bundled.stdout.trim(),
        version: null,
        detail: "bundled via imageio-ffmpeg",
      };
    }
  }
  return { ok: false, path: null, version: null, detail: "ffmpeg not found." };
}

export async function checkEnv(): Promise<EnvStatus> {
  const { status: python, path } = await detectPython();
  const [manim, ffmpeg] = await Promise.all([detectManim(path), detectFfmpeg(path)]);
  return {
    python,
    manim,
    ffmpeg,
    ready: python.ok && manim.ok,
  };
}

/**
 * Create an app-managed virtualenv and pip-install manim into it. Streams log
 * lines back via onLog. This does NOT install system libraries (cairo, pango,
 * LaTeX) — those still need an OS package manager; we surface that in the UI.
 */
export async function installManim(onLog: (line: string) => void): Promise<EnvStatus> {
  const { venvDir } = getPaths();

  // 1. Base python for the venv. Prefer the bundled interpreter so this works
  //    even when the user has no system Python installed.
  let basePython: string | null = bundledPython();
  if (!basePython) {
    for (const cand of ["python3", "python"]) {
      const res = await run(cand, ["--version"], 8000);
      if (res.code === 0) {
        basePython = cand;
        break;
      }
    }
  }
  if (!basePython) {
    onLog("No Python found (bundled or system). Reinstall the app, or install Python 3.10+.");
    return checkEnv();
  }
  onLog(`Using base interpreter: ${basePython}`);

  onLog(`Creating virtual environment with ${basePython}…`);
  const venv = await run(basePython, ["-m", "venv", venvDir], 120000);
  if (venv.code !== 0) {
    onLog(venv.stderr || "Failed to create virtual environment.");
    return checkEnv();
  }

  const py = managedVenvPython();
  if (!py) {
    onLog("Virtual environment python not found after creation.");
    return checkEnv();
  }

  onLog("Upgrading pip…");
  await run(py, ["-m", "pip", "install", "--upgrade", "pip"], 180000);

  onLog("Installing manim (this can take several minutes)…");
  const install = await run(py, ["-m", "pip", "install", "manim"], 1200000);
  onLog(install.stdout.slice(-2000));
  if (install.code !== 0) {
    onLog(install.stderr.slice(-2000));
    onLog(
      "\nInstall failed. Manim needs system libraries (cairo, pango, ffmpeg, and " +
        "LaTeX for formulas). Install those with your OS package manager, then retry.",
    );
  } else {
    onLog("manim installed into the app's managed environment.");
  }

  return checkEnv();
}
