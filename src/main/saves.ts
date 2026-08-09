import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync,
} from "fs";
import { join } from "path";
import { app, dialog } from "electron";
import type { ActionResult, BackupInfo, GameExtras } from "../shared/types";
import { readPrefs } from "./prefs";

type SaveMap = Record<string, { savePath: string }>;

function dataRoot(): string {
  return join(app.getPath("userData"), "hub-data");
}

function saveMapPath(): string {
  return join(dataRoot(), "save-paths.json");
}

function notesPath(gameId: string): string {
  return join(dataRoot(), "notes", `${sanitize(gameId)}.txt`);
}

function backupsRoot(gameId: string): string {
  return join(dataRoot(), "backups", sanitize(gameId));
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function ensureDirs(): void {
  mkdirSync(join(dataRoot(), "notes"), { recursive: true });
  mkdirSync(join(dataRoot(), "backups"), { recursive: true });
}

function readSaveMap(): SaveMap {
  ensureDirs();
  const path = saveMapPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SaveMap;
  } catch {
    return {};
  }
}

function writeSaveMap(map: SaveMap): void {
  ensureDirs();
  writeFileSync(saveMapPath(), JSON.stringify(map, null, 2), "utf8");
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function listChildDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .map((name) => join(root, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export function guessSavePaths(gameName: string): string[] {
  const needle = normalizeName(gameName);
  if (!needle) return [];

  const roots = [
    process.env.USERPROFILE
      ? join(process.env.USERPROFILE, "Documents", "My Games")
      : null,
    process.env.USERPROFILE
      ? join(process.env.USERPROFILE, "Documents")
      : null,
    process.env.USERPROFILE
      ? join(process.env.USERPROFILE, "Saved Games")
      : null,
    process.env.APPDATA ?? null,
    process.env.LOCALAPPDATA ?? null,
  ].filter(Boolean) as string[];

  const hits: string[] = [];

  for (const root of roots) {
    for (const dir of listChildDirs(root)) {
      const base = dir.split(/[/\\]/).pop() ?? "";
      const norm = normalizeName(base);
      if (!norm) continue;
      if (norm === needle || norm.includes(needle) || needle.includes(norm)) {
        hits.push(dir);
      }
    }
  }

  return [...new Set(hits)].slice(0, 8);
}

function listBackups(gameId: string): BackupInfo[] {
  const root = backupsRoot(gameId);
  if (!existsSync(root)) return [];

  return readdirSync(root)
    .map((name) => {
      const path = join(root, name);
      try {
        if (!statSync(path).isDirectory()) return null;
        return {
          id: name,
          createdAt: name,
          path,
          label: name.replace("T", " ").replace(/-/g, "/"),
        } satisfies BackupInfo;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a!.id < b!.id ? 1 : -1)) as BackupInfo[];
}

export function getLinkedSavePath(gameId: string): string | null {
  const map = readSaveMap();
  return map[gameId]?.savePath ?? null;
}

export function getGameExtras(gameId: string, gameName: string): GameExtras {
  ensureDirs();
  const notesFile = notesPath(gameId);
  const notes = existsSync(notesFile) ? readFileSync(notesFile, "utf8") : "";
  const prefs = readPrefs();

  return {
    savePath: getLinkedSavePath(gameId),
    notes,
    backups: listBackups(gameId),
    guessedSavePaths: guessSavePaths(gameName),
    favorite: prefs.favorites.includes(gameId),
    hidden: prefs.hidden.includes(gameId),
    tags: prefs.tags[gameId] ?? [],
    collectionIds: prefs.collections
      .filter((c) => c.gameIds.includes(gameId))
      .map((c) => c.id),
    launchOptions: prefs.launchOptions[gameId] ?? {},
  };
}

export function setSavePath(gameId: string, savePath: string): ActionResult {
  if (!existsSync(savePath)) {
    return { ok: false, error: "That folder does not exist." };
  }
  const map = readSaveMap();
  map[gameId] = { savePath };
  writeSaveMap(map);
  return { ok: true, message: "Save folder linked." };
}

export async function pickSavePath(gameId: string): Promise<ActionResult & { path?: string }> {
  const result = await dialog.showOpenDialog({
    title: "Select this game's save folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: "Cancelled." };
  }
  const path = result.filePaths[0];
  const set = setSavePath(gameId, path);
  if (!set.ok) return set;
  return { ok: true, message: set.message, path };
}

export function saveNotes(gameId: string, notes: string): ActionResult {
  ensureDirs();
  writeFileSync(notesPath(gameId), notes, "utf8");
  return { ok: true, message: "Notes saved." };
}

export function createBackup(gameId: string): ActionResult {
  const map = readSaveMap();
  const savePath = map[gameId]?.savePath;
  if (!savePath) {
    return {
      ok: false,
      error: "Link a save folder first (Pick folder or use a guess).",
    };
  }
  if (!existsSync(savePath)) {
    return { ok: false, error: "Linked save folder is missing." };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupsRoot(gameId), stamp);
  mkdirSync(dest, { recursive: true });
  try {
    cpSync(savePath, dest, { recursive: true });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    return { ok: false, error: `Backup failed: ${String(err)}` };
  }
  return { ok: true, message: `Backup created (${stamp}).` };
}

export function restoreBackup(gameId: string, backupId: string): ActionResult {
  const map = readSaveMap();
  const savePath = map[gameId]?.savePath;
  if (!savePath) {
    return { ok: false, error: "Link a save folder before restoring." };
  }

  const src = join(backupsRoot(gameId), backupId);
  if (!existsSync(src)) {
    return { ok: false, error: "Backup not found." };
  }

  try {
    mkdirSync(savePath, { recursive: true });
    // Replace contents: copy backup over save path
    for (const name of readdirSync(savePath)) {
      rmSync(join(savePath, name), { recursive: true, force: true });
    }
    cpSync(src, savePath, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Restore failed: ${String(err)}` };
  }

  return { ok: true, message: "Backup restored." };
}

export function deleteBackup(gameId: string, backupId: string): ActionResult {
  const src = join(backupsRoot(gameId), backupId);
  if (!existsSync(src)) return { ok: false, error: "Backup not found." };
  try {
    rmSync(src, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  return { ok: true, message: "Backup deleted." };
}
