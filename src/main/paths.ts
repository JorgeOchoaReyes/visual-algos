import { app } from "electron";
import { join } from "path";
import { mkdirSync } from "fs";

/** Resolves and lazily creates the app's on-disk locations under userData. */
export function getPaths() {
  const userData = app.getPath("userData");
  const videosDir = join(userData, "videos");
  const venvDir = join(userData, "manim-venv");

  mkdirSync(videosDir, { recursive: true });

  return {
    userData,
    videosDir,
    venvDir,
    settingsFile: join(userData, "settings.json"),
    libraryFile: join(userData, "library.json"),
    videoFile: (id: string) => join(videosDir, `${id}.mp4`),
  };
}
