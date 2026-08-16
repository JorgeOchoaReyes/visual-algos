import { app, BrowserWindow, protocol, net } from "electron";
import { join } from "path";
import { pathToFileURL } from "url";
import { MEDIA_PROTOCOL } from "@shared/types";
import { registerIpc } from "./ipc";
import { getPaths } from "./paths";

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
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("ready-to-show", () => win.show());

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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
