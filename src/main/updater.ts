import { autoUpdater } from "electron-updater";
import type { BrowserWindow } from "electron";
import type { UpdateStatus } from "../shared/types";

let lastStatus: UpdateStatus = {
  checking: false,
  available: false,
  message: "Updater idle",
};

let mainWindow: BrowserWindow | null = null;

function pushStatus(status: UpdateStatus): void {
  lastStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hub:update-status", status);
  }
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus;
}

export function setupAutoUpdater(win: BrowserWindow): void {
  mainWindow = win;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    pushStatus({
      checking: true,
      available: false,
      message: "Checking for updates…",
    });
  });

  autoUpdater.on("update-available", (info) => {
    pushStatus({
      checking: false,
      available: true,
      version: info.version,
      message: `Update ${info.version} found — downloading…`,
    });
  });

  autoUpdater.on("update-not-available", () => {
    pushStatus({
      checking: false,
      available: false,
      message: "You're on the latest version.",
    });
  });

  autoUpdater.on("error", (err) => {
    pushStatus({
      checking: false,
      available: false,
      message: `Update check skipped: ${err.message}`,
    });
  });

  autoUpdater.on("download-progress", (p) => {
    pushStatus({
      checking: false,
      available: true,
      message: `Downloading update… ${Math.round(p.percent)}%`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    pushStatus({
      checking: false,
      available: true,
      version: info.version,
      message: `Update ${info.version} ready — will install on quit (or restart now).`,
    });
  });
}

/** Check on app open ("login"/session start). Safe no-op in dev without publish config. */
export async function checkForUpdatesOnLaunch(): Promise<UpdateStatus> {
  try {
    pushStatus({
      checking: true,
      available: false,
      message: "Checking for updates…",
    });
    await autoUpdater.checkForUpdates();
  } catch (err) {
    pushStatus({
      checking: false,
      available: false,
      message: `No update feed yet: ${String(err)}`,
    });
  }
  return lastStatus;
}

export async function installUpdateNow(): Promise<void> {
  autoUpdater.quitAndInstall(false, true);
}
