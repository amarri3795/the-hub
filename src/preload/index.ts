import { contextBridge, ipcRenderer } from "electron";
import type { ScanResult } from "../shared/types";

const api = {
  scanLibrary: (): Promise<ScanResult> => ipcRenderer.invoke("hub:scan"),
  launchGame: (
    appId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("hub:launch", appId),
  openSteam: (): Promise<{ ok: true }> => ipcRenderer.invoke("hub:open-steam"),
};

contextBridge.exposeInMainWorld("hub", api);

export type HubApi = typeof api;
