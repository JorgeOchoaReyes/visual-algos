#!/usr/bin/env node
/**
 * Build the bundled Python + Manim runtime that ships inside the app, so end
 * users never install Python, Manim, or ffmpeg themselves.
 *
 * What it does:
 *   1. Downloads a relocatable CPython from `python-build-standalone`
 *      (astral-sh) matching the current OS/arch.
 *   2. Extracts it to resources/pyruntime.
 *   3. pip-installs `manim` + `imageio-ffmpeg` (a bundled static ffmpeg) into it.
 *
 * The result (resources/pyruntime) is packaged by electron-builder as an
 * extraResource. Run this once per target platform before packaging — it is
 * wired into `npm run package`. Cross-OS builds must run on that OS (native
 * wheels + interpreter are platform-specific); the CI workflow does this on
 * macOS, Windows, and Linux runners.
 *
 * Note: LaTeX is intentionally NOT bundled (it's gigabytes). The app prompts
 * Gemini to use Text() instead of MathTex(), so LaTeX isn't needed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, renameSync, createWriteStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// --- Pinned runtime versions (bump intentionally) ---------------------------
const PY_VERSION = "3.11.9";
const PBS_RELEASE = "20240814"; // python-build-standalone release tag
const MANIM_SPEC = "manim==0.18.1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const resourcesDir = join(root, "resources");
const runtimeDir = join(resourcesDir, "pyruntime");
const force = process.argv.includes("--force");

/** Map Node's platform/arch to a python-build-standalone target triple. */
function targetTriple() {
  const p = process.platform;
  const a = process.arch;
  if (p === "linux") {
    if (a === "x64") return "x86_64-unknown-linux-gnu";
    if (a === "arm64") return "aarch64-unknown-linux-gnu";
  }
  if (p === "darwin") {
    if (a === "x64") return "x86_64-apple-darwin";
    if (a === "arm64") return "aarch64-apple-darwin";
  }
  if (p === "win32") {
    if (a === "x64") return "x86_64-pc-windows-msvc";
  }
  throw new Error(`Unsupported platform/arch for bundled runtime: ${p}/${a}`);
}

function assetUrl() {
  const triple = targetTriple();
  const file = `cpython-${PY_VERSION}+${PBS_RELEASE}-${triple}-install_only.tar.gz`;
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/${file}`;
}

/** Path to the python interpreter inside the extracted runtime. */
function runtimePython() {
  return process.platform === "win32"
    ? join(runtimeDir, "python.exe")
    : join(runtimeDir, "bin", "python3");
}

async function download(url, dest) {
  console.log(`↓ Downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

async function main() {
  if (existsSync(runtimePython()) && !force) {
    console.log(`✓ Bundled runtime already present at ${runtimeDir} (use --force to rebuild).`);
    // Ensure manim is importable; if so, we're done.
    try {
      run(runtimePython(), ["-c", "import manim"]);
      console.log("✓ manim import OK — nothing to do.");
      return;
    } catch {
      console.log("… runtime exists but manim not importable; continuing.");
    }
  } else {
    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(resourcesDir, { recursive: true });

    // 1. Download + extract the relocatable interpreter.
    const archive = join(resourcesDir, "python-runtime.tar.gz");
    await download(assetUrl(), archive);

    console.log("… Extracting");
    run("tar", ["-xzf", archive, "-C", resourcesDir]);
    rmSync(archive, { force: true });

    // The archive extracts to resources/python — rename to resources/pyruntime.
    const extracted = join(resourcesDir, "python");
    if (!existsSync(extracted)) {
      throw new Error("Extraction did not produce the expected 'python' directory.");
    }
    rmSync(runtimeDir, { recursive: true, force: true });
    renameSync(extracted, runtimeDir);
  }

  const py = runtimePython();
  if (!existsSync(py)) throw new Error(`Interpreter not found at ${py}`);

  // 2. Install manim + a bundled ffmpeg into the runtime.
  run(py, ["-m", "pip", "install", "--upgrade", "pip", "wheel"]);
  run(py, ["-m", "pip", "install", MANIM_SPEC, "imageio-ffmpeg"]);

  // 3. Sanity check.
  run(py, ["-c", "import manim, imageio_ffmpeg; print('manim', manim.__version__)"]);

  // 4. Trim obvious weight (pip caches, tests) to keep the installer smaller.
  await prune();

  console.log(`\n✓ Bundled runtime ready at ${runtimeDir}`);
}

async function prune() {
  // imageio-ffmpeg ships ffmpeg binaries for every OS; keep only this one's.
  await pruneFfmpegBinaries();

  const junk = ["__pycache__", "test", "tests", "idlelib", "turtledemo", "tkinter"];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (junk.includes(e.name)) {
          rmSync(full, { recursive: true, force: true });
        } else {
          await walk(full);
        }
      }
    }
  }
  await walk(runtimeDir);
}

async function pruneFfmpegBinaries() {
  // Find the imageio_ffmpeg/binaries dir inside the runtime's site-packages.
  const keyword =
    process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
  async function findBinDir(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "binaries" && full.includes("imageio_ffmpeg")) return full;
        const nested = await findBinDir(full);
        if (nested) return nested;
      }
    }
    return null;
  }
  const binDir = await findBinDir(runtimeDir);
  if (!binDir) return;
  for (const e of await readdir(binDir, { withFileTypes: true })) {
    if (e.isFile() && e.name.startsWith("ffmpeg-") && !e.name.includes(keyword)) {
      rmSync(join(binDir, e.name), { force: true });
    }
  }
}

main().catch((err) => {
  console.error("\n✗ setup-python-runtime failed:", err.message);
  process.exit(1);
});
