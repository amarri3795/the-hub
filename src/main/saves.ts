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
import { basename, dirname, join } from "path";
import { app, dialog } from "electron";
import type { ActionResult, BackupInfo, GameExtras } from "../shared/types";
import { readPrefs } from "./prefs";

type SaveMap = Record<string, { savePath: string }>;

type SaveGuess = {
  path: string;
  score: number;
};

const SAVE_FILE_RE =
  /\.(sav|save|dat|bin|json|xml|ess|skse|esl|db|slot|rng|bak|savegame|player)$/i;
const SAVE_NAME_HINT_RE =
  /save|slot|player|profile|persist|userdata|game|inventory|progress/i;
const SAVE_DIR_RE =
  /^(saves?|savegames?|savedata|savedgames?|profiles?|userdata|remote|slots?)$/i;
const SKIP_DIR_RE =
  /^(cache|logs?|crash|crashdumps?|temp|tmp|shadercache|gpuCache|blob_storage|Code Cache|Cache)$/i;

/** Minimum score to auto-link without asking. */
const AUTO_LINK_MIN_SCORE = 55;

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

function listChildNames(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}

function nameOverlapScore(folderNorm: string, gameNorm: string): number {
  if (!folderNorm || !gameNorm) return 0;
  if (folderNorm === gameNorm) return 45;
  if (folderNorm.includes(gameNorm) || gameNorm.includes(folderNorm)) {
    const shorter = Math.min(folderNorm.length, gameNorm.length);
    const longer = Math.max(folderNorm.length, gameNorm.length);
    if (shorter < 4) return 0;
    // Avoid weak overlaps like "game" inside random folders.
    if (shorter / longer < 0.45) return 10;
    return 28;
  }
  return 0;
}

function scoreSaveContents(dir: string): number {
  let score = 0;
  let files = 0;
  let saveFiles = 0;
  try {
    for (const name of listChildNames(dir)) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SAVE_DIR_RE.test(name)) score += 12;
        continue;
      }
      if (!st.isFile()) continue;
      files += 1;
      if (SAVE_FILE_RE.test(name) || SAVE_NAME_HINT_RE.test(name)) {
        saveFiles += 1;
        score += 8;
      }
    }
  } catch {
    return 0;
  }
  if (saveFiles > 0) score += 18;
  if (files > 0 && saveFiles === 0) score -= 4;
  return score;
}

function collectNamedDirs(
  root: string,
  maxDepth: number,
  out: string[],
  depth = 0,
): void {
  if (depth > maxDepth || out.length > 400) return;
  for (const dir of listChildDirs(root)) {
    const base = basename(dir);
    if (SKIP_DIR_RE.test(base) || base.startsWith(".")) continue;
    out.push(dir);
    if (depth + 1 <= maxDepth) {
      collectNamedDirs(dir, maxDepth, out, depth + 1);
    }
  }
}

function addInstallPathCandidates(
  installPath: string | null | undefined,
  out: Set<string>,
): void {
  if (!installPath || !existsSync(installPath)) return;
  out.add(installPath);
  const names = [
    "Saves",
    "Save",
    "SaveGames",
    "SaveData",
    "Saved",
    "Profiles",
    "UserData",
    "save",
    "saves",
  ];
  for (const name of names) {
    const p = join(installPath, name);
    if (existsSync(p)) out.add(p);
  }
  // Common nested: Game/Content/Saves, Game/bin/Saves
  for (const mid of ["Content", "bin", "Game", "Data"]) {
    for (const name of ["Saves", "SaveGames", "SaveData"]) {
      const p = join(installPath, mid, name);
      if (existsSync(p)) out.add(p);
    }
  }
  const parent = dirname(installPath);
  if (parent && parent !== installPath) {
    for (const name of ["Saves", "SaveGames"]) {
      const p = join(parent, name);
      if (existsSync(p)) out.add(p);
    }
  }
}

function addSteamUserdataCandidates(
  steamAppId: string | null | undefined,
  out: Set<string>,
): void {
  if (!steamAppId || !/^\d+$/.test(steamAppId)) return;
  const programFiles = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    "C:\\Program Files (x86)",
    "C:\\Program Files",
  ].filter(Boolean) as string[];

  for (const pf of programFiles) {
    const userdata = join(pf, "Steam", "userdata");
    if (!existsSync(userdata)) continue;
    for (const userDir of listChildDirs(userdata)) {
      const remote = join(userDir, steamAppId, "remote");
      if (existsSync(remote)) out.add(remote);
      const appDir = join(userDir, steamAppId);
      if (existsSync(appDir)) out.add(appDir);
    }
  }
}

export function rankSavePathGuesses(
  gameName: string,
  installPath?: string | null,
  steamAppId?: string | null,
): SaveGuess[] {
  const gameNorm = normalizeName(gameName);
  if (!gameNorm) return [];

  const userProfile = process.env.USERPROFILE ?? null;
  const localAppData = process.env.LOCALAPPDATA ?? null;
  const localLow =
    userProfile != null ? join(userProfile, "AppData", "LocalLow") : null;

  const searchRoots: Array<{ root: string; depth: number; bonus: number }> = [
    {
      root: userProfile ? join(userProfile, "Documents", "My Games") : "",
      depth: 2,
      bonus: 10,
    },
    {
      root: userProfile ? join(userProfile, "Saved Games") : "",
      depth: 2,
      bonus: 10,
    },
    {
      root: userProfile ? join(userProfile, "Documents") : "",
      depth: 2,
      bonus: 4,
    },
    { root: process.env.APPDATA ?? "", depth: 2, bonus: 6 },
    { root: localAppData ?? "", depth: 2, bonus: 6 },
    { root: localLow ?? "", depth: 2, bonus: 14 }, // Unity / many indies
  ].filter((r) => !!r.root);

  const candidates = new Set<string>();
  for (const { root, depth } of searchRoots) {
    const dirs: string[] = [];
    collectNamedDirs(root, depth, dirs);
    for (const dir of dirs) candidates.add(dir);
  }
  addInstallPathCandidates(installPath, candidates);
  addSteamUserdataCandidates(steamAppId, candidates);

  const scored: SaveGuess[] = [];
  for (const path of candidates) {
    const base = basename(path);
    const parent = basename(dirname(path));
    const baseNorm = normalizeName(base);
    const parentNorm = normalizeName(parent);

    let score = 0;
    const baseHit = nameOverlapScore(baseNorm, gameNorm);
    const parentHit = nameOverlapScore(parentNorm, gameNorm);
    score += Math.max(baseHit, parentHit > 0 ? parentHit - 8 : 0);

    // LocalLow\Company\Game — game folder is often the leaf.
    if (localLow && path.toLowerCase().startsWith(localLow.toLowerCase())) {
      score += 8;
      if (baseHit >= 28) score += 8;
    }
    if (SAVE_DIR_RE.test(base)) {
      score += 16;
      // Saves folder under a matching game/publisher folder.
      if (parentHit >= 28) score += 18;
    }

    score += scoreSaveContents(path);

    for (const { root, bonus } of searchRoots) {
      if (path.toLowerCase().startsWith(root.toLowerCase())) {
        score += bonus;
        break;
      }
    }

    if (installPath && path.toLowerCase().startsWith(installPath.toLowerCase())) {
      score += 12;
    }

    if (score < 30) continue;
    scored.push({ path, score });
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  // Prefer the best unique paths; collapse nested duplicates by keeping higher score.
  const kept: SaveGuess[] = [];
  for (const guess of scored) {
    const nested = kept.some(
      (k) =>
        guess.path.toLowerCase().startsWith(k.path.toLowerCase() + "\\") ||
        guess.path.toLowerCase().startsWith(k.path.toLowerCase() + "/") ||
        k.path.toLowerCase().startsWith(guess.path.toLowerCase() + "\\") ||
        k.path.toLowerCase().startsWith(guess.path.toLowerCase() + "/"),
    );
    if (nested) {
      // Replace with higher-score path already handled by sort; skip lower nested.
      continue;
    }
    kept.push(guess);
    if (kept.length >= 8) break;
  }
  return kept;
}

export function guessSavePaths(
  gameName: string,
  installPath?: string | null,
  steamAppId?: string | null,
): string[] {
  return rankSavePathGuesses(gameName, installPath, steamAppId).map(
    (g) => g.path,
  );
}

export function getLinkedSavePath(gameId: string): string | null {
  const map = readSaveMap();
  return map[gameId]?.savePath ?? null;
}

export function getGameExtras(
  gameId: string,
  gameName: string,
  installPath?: string | null,
  steamAppId?: string | null,
): GameExtras {
  ensureDirs();
  const notesFile = notesPath(gameId);
  const notes = existsSync(notesFile) ? readFileSync(notesFile, "utf8") : "";
  const prefs = readPrefs();

  return {
    savePath: getLinkedSavePath(gameId),
    notes,
    backups: listBackups(gameId),
    guessedSavePaths: guessSavePaths(gameName, installPath, steamAppId),
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
  try {
    if (!statSync(savePath).isDirectory()) {
      return { ok: false, error: "That path is not a folder." };
    }
  } catch {
    return { ok: false, error: "Could not read that folder." };
  }
  const map = readSaveMap();
  map[gameId] = { savePath };
  writeSaveMap(map);
  return { ok: true, message: "Save folder linked." };
}

export function autoFindSavePath(
  gameId: string,
  gameName: string,
  installPath?: string | null,
  steamAppId?: string | null,
  opts?: { force?: boolean },
): ActionResult & { path?: string; guesses?: string[] } {
  const existing = getLinkedSavePath(gameId);
  if (existing && existsSync(existing) && !opts?.force) {
    return {
      ok: true,
      path: existing,
      message: "Save folder already linked.",
      guesses: guessSavePaths(gameName, installPath, steamAppId),
    };
  }

  const ranked = rankSavePathGuesses(gameName, installPath, steamAppId);
  const guesses = ranked.map((g) => g.path);
  const best = ranked[0];
  if (!best) {
    return {
      ok: false,
      error:
        "Couldn't find a save folder automatically. Pick one manually or play the game once so it creates saves.",
      guesses,
    };
  }

  const second = ranked[1];
  const confident =
    best.score >= AUTO_LINK_MIN_SCORE &&
    (!second || best.score >= second.score + 8 || best.score >= 75);

  if (!confident && !opts?.force) {
    return {
      ok: false,
      error:
        "Found possible save folders, but none look certain. Pick one from the guesses below.",
      guesses,
    };
  }

  // When forcing (Auto-find button), take the best candidate even if medium confidence.
  if (opts?.force && best.score < 35) {
    return {
      ok: false,
      error:
        "Couldn't find a likely save folder. Pick one manually or play the game once so it creates saves.",
      guesses,
    };
  }

  const linked = setSavePath(gameId, best.path);
  if (!linked.ok) return { ...linked, guesses };
  return {
    ok: true,
    path: best.path,
    guesses,
    message: `Auto-linked save folder: ${best.path}`,
  };
}

export async function pickSavePath(
  gameId: string,
): Promise<ActionResult & { path?: string }> {
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

export function createBackup(gameId: string): ActionResult {
  const map = readSaveMap();
  const savePath = map[gameId]?.savePath;
  if (!savePath) {
    return {
      ok: false,
      error: "Link a save folder first (Auto-find, Pick folder, or use a guess).",
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
