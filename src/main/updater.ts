import { app, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
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

  // NSIS installs use electron-updater's standard GitHub feed (latest.yml).
  // Portable builds do not receive auto-updates.
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

/** Check on app open. Skipped in development; NSIS installs use GitHub latest.yml. */
export async function checkForUpdatesOnLaunch(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    pushStatus({
      checking: false,
      available: false,
      message: "Updates disabled in development.",
    });
    return lastStatus;
  }

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
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
}
