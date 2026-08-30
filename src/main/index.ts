import { app, BrowserWindow, protocol } from "electron";
import { existsSync, promises as fsp } from "fs";
import { join } from "path";
import { MEDIA_PROTOCOL } from "@shared/types";
import { registerIpc } from "./ipc";
import { initAutoUpdate } from "./updater";
import { ensureRenderer, registerSetup } from "./setup";
import { getPaths } from "./paths";
import { log } from "./log";

process.on("uncaughtException", (err) => log.error("main", "uncaughtException", err));
process.on("unhandledRejection", (reason) => log.error("main", "unhandledRejection", reason));

/** Absolute path to the app icon, for the window (Linux/dev). */
function iconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.png")]
    : [join(app.getAppPath(), "build", "icon.png")];
  return candidates.find((p) => existsSync(p));
}

// Register our media scheme as privileged BEFORE the app is ready so the
// renderer can stream rendered videos (with range requests for seeking).
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
]);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0e14",
    title: "Vizuals",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Allow the rendered video to autoplay WITH sound (Chromium otherwise
      // autoplays muted, which reads as "no audio").
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.on("ready-to-show", () => win.show());

  // Once the UI is loaded, verify (and if needed auto-provision) the renderer.
  win.webContents.once("did-finish-load", () => {
    void ensureRenderer();
  });

  // electron-vite provides the dev server URL in development.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // Serve vizmedia://<id> from disk WITH HTTP range support, so the <video>
  // element can scrub/seek instead of only playing linearly.
  protocol.handle(MEDIA_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const id = (url.hostname || url.pathname.replace(/^\/+/, "")).replace(/[^a-zA-Z0-9-]/g, "");
    const file = getPaths().videoFile(id);
    try {
      const stat = await fsp.stat(file);
      const total = stat.size;
      const range = request.headers.get("Range");
      const baseHeaders: Record<string, string> = {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      };

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (start > end) start = 0;
        const size = end - start + 1;
        const buf = Buffer.alloc(size);
        const fh = await fsp.open(file, "r");
        try {
          await fh.read(buf, 0, size, start);
        } finally {
          await fh.close();
        }
        return new Response(buf, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Content-Length": String(size),
          },
        });
      }

      const data = await fsp.readFile(file);
      return new Response(data, {
        status: 200,
        headers: { ...baseHeaders, "Content-Length": String(total) },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  log.info("main", `app ready v${app.getVersion()}`, { platform: process.platform, packaged: app.isPackaged });
  registerIpc();
  registerSetup();
  initAutoUpdate();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
