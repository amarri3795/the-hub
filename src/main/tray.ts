import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import { join } from "path";
import { readPrefs } from "./prefs";

let tray: Tray | null = null;

function iconPath(): string {
  return join(__dirname, "../../resources/icon.png");
}

export function setupTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return;

  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
  tray.setToolTip("The Hub");

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: "Show The Hub",
        click: () => {
          const win = getWindow();
          if (!win) return;
          win.show();
          win.focus();
        },
      },
      {
        label: "Check for updates",
        click: () => {
          const win = getWindow();
          win?.webContents.send("hub:request-update-check");
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);
    tray?.setContextMenu(menu);
  };

  rebuild();
  tray.on("double-click", () => {
    const win = getWindow();
    if (!win) return;
    win.show();
    win.focus();
  });
}

export function shouldCloseToTray(): boolean {
  return readPrefs().closeToTray !== false;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
