import { app, BrowserWindow, protocol, net } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { MEDIA_PROTOCOL } from "@shared/types";
import { registerIpc } from "./ipc";
import { initAutoUpdate } from "./updater";
import { ensureRenderer, registerSetup } from "./setup";
import { getPaths } from "./paths";

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
    title: "Visual Algos",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
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
  // Serve vizmedia://<id> from the on-disk videos folder.
  protocol.handle(MEDIA_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const id = (url.hostname || url.pathname.replace(/^\/+/, "")).replace(/[^a-zA-Z0-9-]/g, "");
    const file = getPaths().videoFile(id);
    return net.fetch(pathToFileURL(file).toString());
  });

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
