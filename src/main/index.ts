import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";
import { scanSteamLibrary } from "./steam";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "The Hub",
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("hub:scan", () => scanSteamLibrary());

  ipcMain.handle("hub:launch", async (_event, appId: string) => {
    if (!appId || !/^\d+$/.test(appId)) {
      return { ok: false as const, error: "Invalid Steam app id" };
    }
    await shell.openExternal(`steam://rungameid/${appId}`);
    return { ok: true as const };
  });

  ipcMain.handle("hub:open-steam", async () => {
    await shell.openExternal("steam://open/games");
    return { ok: true as const };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
