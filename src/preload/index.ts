import { contextBridge, ipcRenderer } from "electron";
import type {
  ActionResult,
  GameExtras,
  GridDensity,
  HubGame,
  LaunchOptions,
  LibraryPrefs,
  PremiumStatus,
  SaveBytesResult,
  SaveFileEntry,
  SaveJsonField,
  SaveReplaceResult,
  SaveScanResult,
  SaveValueKind,
  ScanResult,
  SortBy,
  UpdateStatus,
} from "../shared/types";

const api = {
  scanLibrary: (): Promise<ScanResult> => ipcRenderer.invoke("hub:scan"),
  launchGame: (game: HubGame): Promise<ActionResult> =>
    ipcRenderer.invoke("hub:launch", game),
  openSteam: (): Promise<{ ok: true }> => ipcRenderer.invoke("hub:open-steam"),
  openEpic: (): Promise<{ ok: true }> => ipcRenderer.invoke("hub:open-epic"),
  openUbisoft: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke("hub:open-ubisoft"),
  getExtras: (gameId: string, gameName: string): Promise<GameExtras> =>
    ipcRenderer.invoke("hub:extras", gameId, gameName),
  pickSavePath: (
    gameId: string,
  ): Promise<ActionResult & { path?: string }> =>
    ipcRenderer.invoke("hub:pick-save", gameId),
  setSavePath: (gameId: string, savePath: string): Promise<ActionResult> =>
    ipcRenderer.invoke("hub:set-save", gameId, savePath),
  saveNotes: (gameId: string, notes: string): Promise<ActionResult> =>
    ipcRenderer.invoke("hub:save-notes", gameId, notes),
  createBackup: (gameId: string): Promise<ActionResult> =>
    ipcRenderer.invoke("hub:backup", gameId),
  restoreBackup: (gameId: string, backupId: string): Promise<ActionResult> =>
    ipcRenderer.invoke("hub:restore", gameId, backupId),
  deleteBackup: (gameId: string, backupId: string): Promise<ActionResult> =>
    ipcRenderer.invoke("hub:delete-backup", gameId, backupId),
  listSaveFiles: (
    gameId: string,
  ): Promise<ActionResult & { files?: SaveFileEntry[]; truncated?: boolean }> =>
    ipcRenderer.invoke("hub:list-save-files", gameId),
  inspectSaveFile: (
    gameId: string,
    relativePath: string,
  ): Promise<
    ActionResult & {
      kind?: "json" | "text" | "binary";
      jsonFields?: SaveJsonField[];
      textPreview?: string;
      fileSize?: number;
      truncatedJson?: boolean;
    }
  > => ipcRenderer.invoke("hub:inspect-save-file", gameId, relativePath),
  readSaveBytes: (
    gameId: string,
    relativePath: string,
  ): Promise<SaveBytesResult> =>
    ipcRenderer.invoke("hub:read-save-bytes", gameId, relativePath),
  writeSaveBytes: (
    gameId: string,
    relativePath: string,
    base64: string,
  ): Promise<ActionResult> =>
    ipcRenderer.invoke("hub:write-save-bytes", gameId, relativePath, base64),
  scanSaveValues: (
    gameId: string,
    relativePath: string,
    value: number,
    kinds?: SaveValueKind[],
  ): Promise<SaveScanResult> =>
    ipcRenderer.invoke("hub:scan-save-values", gameId, relativePath, value, kinds),
  replaceSaveValues: (
    gameId: string,
    relativePath: string,
    replacements: Array<{
      offset: number;
      kind: SaveValueKind;
      oldValue: number;
      newValue: number;
    }>,
  ): Promise<SaveReplaceResult> =>
    ipcRenderer.invoke(
      "hub:replace-save-values",
      gameId,
      relativePath,
      replacements,
    ),
  replaceSaveJsonField: (
    gameId: string,
    relativePath: string,
    fieldPath: string,
    newValue: number,
  ): Promise<SaveReplaceResult> =>
    ipcRenderer.invoke(
      "hub:replace-save-json-field",
      gameId,
      relativePath,
      fieldPath,
      newValue,
    ),
  getPrefs: (): Promise<LibraryPrefs> => ipcRenderer.invoke("hub:prefs"),
  toggleFavorite: (gameId: string): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:toggle-favorite", gameId),
  toggleHidden: (gameId: string): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:toggle-hidden", gameId),
  setTags: (gameId: string, tags: string[]): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:set-tags", gameId, tags),
  addCustomGame: (): Promise<
    ActionResult & { prefs?: LibraryPrefs; game?: HubGame }
  > => ipcRenderer.invoke("hub:add-custom"),
  removeCustomGame: (gameId: string): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:remove-custom", gameId),
  updateSettings: (
    patch: Partial<{
      sortBy: SortBy;
      gridDensity: GridDensity;
      accentColor: string;
      closeToTray: boolean;
    }>,
  ): Promise<LibraryPrefs> => ipcRenderer.invoke("hub:update-settings", patch),
  setLaunchOptions: (
    gameId: string,
    options: LaunchOptions,
  ): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:set-launch-options", gameId, options),
  createCollection: (name: string): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:create-collection", name),
  renameCollection: (id: string, name: string): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:rename-collection", id, name),
  deleteCollection: (id: string): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:delete-collection", id),
  toggleGameInCollection: (
    collectionId: string,
    gameId: string,
  ): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:toggle-collection-game", collectionId, gameId),
  importSteamCategories: (): Promise<LibraryPrefs> =>
    ipcRenderer.invoke("hub:import-steam-categories"),
  getPremiumStatus: (): Promise<PremiumStatus> =>
    ipcRenderer.invoke("hub:premium-status"),
  activateLicense: (
    key: string,
  ): Promise<ActionResult & { status: PremiumStatus }> =>
    ipcRenderer.invoke("hub:activate-license", key),
  deactivateLicense: (): Promise<ActionResult & { status: PremiumStatus }> =>
    ipcRenderer.invoke("hub:deactivate-license"),
  getUpdateStatus: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("hub:update-status"),
  checkUpdates: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("hub:check-updates"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("hub:install-update"),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, status: UpdateStatus) =>
      cb(status);
    ipcRenderer.on("hub:update-status", listener);
    return () => ipcRenderer.removeListener("hub:update-status", listener);
  },
  onRequestUpdateCheck: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("hub:request-update-check", listener);
    return () =>
      ipcRenderer.removeListener("hub:request-update-check", listener);
  },
  windowMinimize: (): Promise<void> => ipcRenderer.invoke("hub:window-minimize"),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke("hub:window-maximize"),
  windowClose: (): Promise<void> => ipcRenderer.invoke("hub:window-close"),
};

contextBridge.exposeInMainWorld("hub", api);

export type HubApi = typeof api;
