import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  shell,
} from "electron";
import { join } from "path";
import { pathToFileURL } from "url";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { scanAllLibraries } from "./library";
import {
  createBackup,
  deleteBackup,
  getGameExtras,
  pickSavePath,
  restoreBackup,
  saveNotes,
  setSavePath,
} from "./saves";
import {
  inspectSaveFile,
  listSaveFiles,
  replaceSaveJsonField,
  replaceSaveValues,
  scanSaveValues,
} from "./saveEditor";
import {
  addCustomGame,
  createCollection,
  deleteCollection,
  mergeSteamCategories,
  readPrefs,
  recordRecent,
  removeCustomGame,
  renameCollection,
  setLaunchOptions,
  setTags,
  toggleFavorite,
  toggleGameInCollection,
  toggleHidden,
  updateSettings,
} from "./prefs";
import {
  checkForUpdatesOnLaunch,
  getUpdateStatus,
  installUpdateNow,
  setupAutoUpdater,
} from "./updater";
import { setupTray, shouldCloseToTray } from "./tray";
import { readSteamCategories } from "./steamCategories";
import { findSteamPath } from "./steam";
import {
  activateLicense,
  deactivateLicense,
  getPremiumStatus,
  isDefaultAccent,
  isPremiumUnlocked,
  premiumDenied,
} from "./license";
import type { HubGame, LaunchOptions } from "../shared/types";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "hubimg",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "The Hub",
    backgroundColor: "#0b0f14",
    frame: false,
    titleBarStyle: "hidden",
    show: false,
    icon: join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    void checkForUpdatesOnLaunch();
  });

  win.on("close", (e) => {
    if (!isQuitting && shouldCloseToTray()) {
      e.preventDefault();
      win.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  return win;
}

function launchExeWithOptions(exePath: string, opts: LaunchOptions = {}) {
  try {
    if (opts.runAsAdmin) {
      const ps = [
        "Start-Process",
        `-FilePath '${exePath.replace(/'/g, "''")}'`,
      ];
      if (opts.args?.trim()) {
        ps.push(`-ArgumentList '${opts.args.replace(/'/g, "''")}'`);
      }
      if (opts.cwd?.trim()) {
        ps.push(`-WorkingDirectory '${opts.cwd.replace(/'/g, "''")}'`);
      }
      ps.push("-Verb RunAs");
      spawn("powershell.exe", ["-NoProfile", "-Command", ps.join(" ")], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return { ok: true as const };
    }

    const args = opts.args?.trim()
      ? opts.args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, "")) ??
        opts.args.split(/\s+/).filter(Boolean)
      : [];
    spawn(exePath, args, {
      cwd: opts.cwd?.trim() || undefined,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    }).unref();
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

async function launchAppx(appId: string) {
  await execFileAsync("explorer.exe", [`shell:AppsFolder\\${appId}`]);
  return { ok: true as const };
}

async function launchGame(game: HubGame) {
  if (!game.launchId) {
    return { ok: false as const, error: "No launch target for this game." };
  }

  const opts = readPrefs().launchOptions[game.id] ?? {};

  if (game.launchId.startsWith("exe:")) {
    return launchExeWithOptions(game.launchId.slice(4), opts);
  }

  if (game.launchId.startsWith("appx:")) {
    return launchAppx(game.launchId.slice(5));
  }

  if (game.launchId.startsWith("protocol:")) {
    await shell.openExternal(game.launchId.slice("protocol:".length));
    return { ok: true as const };
  }

  if (game.store === "steam") {
    if (!/^\d+$/.test(game.launchId)) {
      return { ok: false as const, error: "Invalid Steam app id." };
    }
    const extra = opts.args?.trim()
      ? `//${encodeURIComponent(opts.args.trim())}`
      : "";
    await shell.openExternal(`steam://rungameid/${game.launchId}${extra}`);
    return { ok: true as const };
  }

  if (game.store === "epic") {
    const { catalogNamespace, catalogItemId, launchId } = game;
    const uri =
      catalogNamespace && catalogItemId
        ? `com.epicgames.launcher://apps/${catalogNamespace}%3A${catalogItemId}%3A${encodeURIComponent(launchId)}?action=launch&silent=true`
        : `com.epicgames.launcher://apps/${encodeURIComponent(launchId)}?action=launch&silent=true`;
    await shell.openExternal(uri);
    return { ok: true as const };
  }

  if (game.store === "ubisoft") {
    if (/^\d+$/.test(game.launchId)) {
      await shell.openExternal(`uplay://launch/${game.launchId}/0`);
      return { ok: true as const };
    }
    return { ok: false as const, error: "No Ubisoft launch id for this game." };
  }

  if (game.store === "minecraft") {
    await shell.openExternal("minecraft:");
    return { ok: true as const };
  }

  return { ok: false as const, error: "Unsupported store." };
}

app.whenReady().then(() => {
  protocol.handle("hubimg", (request) => {
    try {
      const parsed = new URL(request.url);
      const filePath = parsed.searchParams.get("path");
      if (!filePath) {
        return new Response("Missing path", { status: 400 });
      }
      return net.fetch(pathToFileURL(filePath).href);
    } catch {
      return new Response("Invalid hubimg URL", { status: 400 });
    }
  });

  ipcMain.handle("hub:scan", () => scanAllLibraries());
  ipcMain.handle("hub:launch", async (_e, game: HubGame) => {
    const result = await launchGame(game);
    if (result.ok) recordRecent(game.id);
    return result;
  });
  ipcMain.handle("hub:open-steam", async () => {
    await shell.openExternal("steam://open/games");
    return { ok: true as const };
  });
  ipcMain.handle("hub:open-epic", async () => {
    await shell.openExternal("com.epicgames.launcher://");
    return { ok: true as const };
  });
  ipcMain.handle("hub:open-ubisoft", async () => {
    await shell.openExternal("uplay://");
    return { ok: true as const };
  });

  ipcMain.handle("hub:extras", (_e, gameId: string, gameName: string) =>
    getGameExtras(gameId, gameName),
  );
  ipcMain.handle("hub:pick-save", (_e, gameId: string) => pickSavePath(gameId));
  ipcMain.handle("hub:set-save", (_e, gameId: string, savePath: string) =>
    setSavePath(gameId, savePath),
  );
  ipcMain.handle("hub:save-notes", (_e, gameId: string, notes: string) =>
    saveNotes(gameId, notes),
  );
  ipcMain.handle("hub:backup", (_e, gameId: string) => {
    if (!isPremiumUnlocked()) return premiumDenied("Save backups");
    return createBackup(gameId);
  });
  ipcMain.handle("hub:restore", (_e, gameId: string, backupId: string) => {
    if (!isPremiumUnlocked()) return premiumDenied("Save backups");
    return restoreBackup(gameId, backupId);
  });
  ipcMain.handle("hub:delete-backup", (_e, gameId: string, backupId: string) => {
    if (!isPremiumUnlocked()) return premiumDenied("Save backups");
    return deleteBackup(gameId, backupId);
  });
  ipcMain.handle("hub:list-save-files", (_e, gameId: string) => {
    if (!isPremiumUnlocked()) return premiumDenied("Save value editor");
    return listSaveFiles(gameId);
  });
  ipcMain.handle(
    "hub:inspect-save-file",
    (_e, gameId: string, relativePath: string) => {
      if (!isPremiumUnlocked()) return premiumDenied("Save value editor");
      return inspectSaveFile(gameId, relativePath);
    },
  );
  ipcMain.handle(
    "hub:scan-save-values",
    (
      _e,
      gameId: string,
      relativePath: string,
      value: number,
      kinds?: Array<"i32le" | "u32le" | "i64le" | "f32le" | "text">,
    ) => {
      if (!isPremiumUnlocked()) return premiumDenied("Save value editor");
      return scanSaveValues(gameId, relativePath, value, kinds);
    },
  );
  ipcMain.handle(
    "hub:replace-save-values",
    (
      _e,
      gameId: string,
      relativePath: string,
      replacements: Array<{
        offset: number;
        kind: "i32le" | "u32le" | "i64le" | "f32le" | "text";
        oldValue: number;
        newValue: number;
      }>,
    ) => {
      if (!isPremiumUnlocked()) return premiumDenied("Save value editor");
      return replaceSaveValues(gameId, relativePath, replacements);
    },
  );
  ipcMain.handle(
    "hub:replace-save-json-field",
    (
      _e,
      gameId: string,
      relativePath: string,
      fieldPath: string,
      newValue: number,
    ) => {
      if (!isPremiumUnlocked()) return premiumDenied("Save value editor");
      return replaceSaveJsonField(gameId, relativePath, fieldPath, newValue);
    },
  );

  ipcMain.handle("hub:prefs", () => readPrefs());
  ipcMain.handle("hub:toggle-favorite", (_e, gameId: string) =>
    toggleFavorite(gameId),
  );
  ipcMain.handle("hub:toggle-hidden", (_e, gameId: string) =>
    toggleHidden(gameId),
  );
  ipcMain.handle("hub:set-tags", (_e, gameId: string, tags: string[]) =>
    setTags(gameId, tags),
  );
  ipcMain.handle("hub:add-custom", () => addCustomGame());
  ipcMain.handle("hub:remove-custom", (_e, gameId: string) =>
    removeCustomGame(gameId),
  );
  ipcMain.handle("hub:update-settings", (_e, patch) => {
    if (
      patch?.accentColor &&
      !isDefaultAccent(String(patch.accentColor)) &&
      !isPremiumUnlocked()
    ) {
      return readPrefs();
    }
    return updateSettings(patch);
  });
  ipcMain.handle("hub:set-launch-options", (_e, gameId: string, options) => {
    if (!isPremiumUnlocked()) return readPrefs();
    return setLaunchOptions(gameId, options);
  });
  ipcMain.handle("hub:create-collection", (_e, name: string) => {
    if (!isPremiumUnlocked()) return readPrefs();
    return createCollection(name);
  });
  ipcMain.handle("hub:rename-collection", (_e, id: string, name: string) => {
    if (!isPremiumUnlocked()) return readPrefs();
    return renameCollection(id, name);
  });
  ipcMain.handle("hub:delete-collection", (_e, id: string) => {
    if (!isPremiumUnlocked()) return readPrefs();
    return deleteCollection(id);
  });
  ipcMain.handle(
    "hub:toggle-collection-game",
    (_e, collectionId: string, gameId: string) => {
      if (!isPremiumUnlocked()) return readPrefs();
      return toggleGameInCollection(collectionId, gameId);
    },
  );
  ipcMain.handle("hub:import-steam-categories", () => {
    if (!isPremiumUnlocked()) return readPrefs();
    const cats = readSteamCategories(findSteamPath());
    return mergeSteamCategories(cats);
  });

  ipcMain.handle("hub:premium-status", () => getPremiumStatus());
  ipcMain.handle("hub:activate-license", (_e, key: string) =>
    activateLicense(typeof key === "string" ? key : ""),
  );
  ipcMain.handle("hub:deactivate-license", () => deactivateLicense());

  ipcMain.handle("hub:update-status", () => getUpdateStatus());
  ipcMain.handle("hub:check-updates", () => checkForUpdatesOnLaunch());
  ipcMain.handle("hub:install-update", () => installUpdateNow());

  ipcMain.handle("hub:window-minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("hub:window-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("hub:window-close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  const win = createWindow();
  setupAutoUpdater(win);
  setupTray(() => mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      setupAutoUpdater(w);
    } else {
      mainWindow?.show();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
