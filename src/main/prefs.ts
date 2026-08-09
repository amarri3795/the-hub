import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { app, dialog } from "electron";
import type {
  ActionResult,
  Collection,
  GridDensity,
  HubGame,
  LaunchOptions,
  LibraryPrefs,
  SortBy,
} from "../shared/types";

const DEFAULT_PREFS: LibraryPrefs = {
  favorites: [],
  hidden: [],
  tags: {},
  recent: [],
  customGames: [],
  collections: [],
  sortBy: "name",
  gridDensity: "comfortable",
  accentColor: "#3d8bfd",
  closeToTray: true,
  launchOptions: {},
};

function prefsPath(): string {
  const dir = join(app.getPath("userData"), "hub-data");
  mkdirSync(dir, { recursive: true });
  return join(dir, "library-prefs.json");
}

export function readPrefs(): LibraryPrefs {
  const path = prefsPath();
  if (!existsSync(path)) return structuredClone(DEFAULT_PREFS);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LibraryPrefs>;
    return {
      favorites: raw.favorites ?? [],
      hidden: raw.hidden ?? [],
      tags: raw.tags ?? {},
      recent: raw.recent ?? [],
      customGames: raw.customGames ?? [],
      collections: raw.collections ?? [],
      sortBy: raw.sortBy ?? "name",
      gridDensity: raw.gridDensity ?? "comfortable",
      accentColor: raw.accentColor ?? "#3d8bfd",
      closeToTray: raw.closeToTray ?? true,
      launchOptions: raw.launchOptions ?? {},
    };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

function writePrefs(prefs: LibraryPrefs): void {
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
}

export function updateSettings(
  patch: Partial<
    Pick<
      LibraryPrefs,
      "sortBy" | "gridDensity" | "accentColor" | "closeToTray"
    >
  >,
): LibraryPrefs {
  const prefs = readPrefs();
  if (patch.sortBy) prefs.sortBy = patch.sortBy as SortBy;
  if (patch.gridDensity) prefs.gridDensity = patch.gridDensity as GridDensity;
  if (patch.accentColor) prefs.accentColor = patch.accentColor;
  if (typeof patch.closeToTray === "boolean") prefs.closeToTray = patch.closeToTray;
  writePrefs(prefs);
  return prefs;
}

export function toggleFavorite(gameId: string): LibraryPrefs {
  const prefs = readPrefs();
  prefs.favorites = prefs.favorites.includes(gameId)
    ? prefs.favorites.filter((id) => id !== gameId)
    : [...prefs.favorites, gameId];
  writePrefs(prefs);
  return prefs;
}

export function toggleHidden(gameId: string): LibraryPrefs {
  const prefs = readPrefs();
  prefs.hidden = prefs.hidden.includes(gameId)
    ? prefs.hidden.filter((id) => id !== gameId)
    : [...prefs.hidden, gameId];
  writePrefs(prefs);
  return prefs;
}

export function setTags(gameId: string, tags: string[]): LibraryPrefs {
  const prefs = readPrefs();
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (cleaned.length === 0) delete prefs.tags[gameId];
  else prefs.tags[gameId] = cleaned;
  writePrefs(prefs);
  return prefs;
}

export function recordRecent(gameId: string): LibraryPrefs {
  const prefs = readPrefs();
  prefs.recent = [
    { id: gameId, at: Date.now() },
    ...prefs.recent.filter((r) => r.id !== gameId),
  ].slice(0, 40);
  writePrefs(prefs);
  return prefs;
}

export function setLaunchOptions(
  gameId: string,
  options: LaunchOptions,
): LibraryPrefs {
  const prefs = readPrefs();
  const cleaned: LaunchOptions = {
    args: options.args?.trim() || undefined,
    cwd: options.cwd?.trim() || undefined,
    runAsAdmin: options.runAsAdmin || undefined,
  };
  if (!cleaned.args && !cleaned.cwd && !cleaned.runAsAdmin) {
    delete prefs.launchOptions[gameId];
  } else {
    prefs.launchOptions[gameId] = cleaned;
  }
  writePrefs(prefs);
  return prefs;
}

export function createCollection(name: string): LibraryPrefs {
  const prefs = readPrefs();
  const cleaned = name.trim() || "New collection";
  const collection: Collection = {
    id: `col-${Date.now().toString(36)}`,
    name: cleaned,
    gameIds: [],
  };
  prefs.collections = [...prefs.collections, collection];
  writePrefs(prefs);
  return prefs;
}

export function renameCollection(id: string, name: string): LibraryPrefs {
  const prefs = readPrefs();
  prefs.collections = prefs.collections.map((c) =>
    c.id === id ? { ...c, name: name.trim() || c.name } : c,
  );
  writePrefs(prefs);
  return prefs;
}

export function deleteCollection(id: string): LibraryPrefs {
  const prefs = readPrefs();
  prefs.collections = prefs.collections.filter((c) => c.id !== id);
  writePrefs(prefs);
  return prefs;
}

export function toggleGameInCollection(
  collectionId: string,
  gameId: string,
): LibraryPrefs {
  const prefs = readPrefs();
  prefs.collections = prefs.collections.map((c) => {
    if (c.id !== collectionId) return c;
    const has = c.gameIds.includes(gameId);
    return {
      ...c,
      gameIds: has
        ? c.gameIds.filter((id) => id !== gameId)
        : [...c.gameIds, gameId],
    };
  });
  writePrefs(prefs);
  return prefs;
}

export function mergeSteamCategories(
  byAppId: Record<string, string[]>,
): LibraryPrefs {
  const prefs = readPrefs();
  for (const [appId, cats] of Object.entries(byAppId)) {
    const gameId = `steam-${appId}`;
    const existing = new Set(prefs.tags[gameId] ?? []);
    for (const c of cats) {
      if (c.toLowerCase() === "favorite") {
        if (!prefs.favorites.includes(gameId)) prefs.favorites.push(gameId);
        continue;
      }
      existing.add(c);
    }
    prefs.tags[gameId] = [...existing];

    for (const cat of cats) {
      if (cat.toLowerCase() === "favorite") continue;
      let col = prefs.collections.find(
        (c) => c.name.toLowerCase() === cat.toLowerCase(),
      );
      if (!col) {
        col = {
          id: `col-steam-${Buffer.from(cat).toString("base64url").slice(0, 12)}`,
          name: cat,
          gameIds: [],
        };
        prefs.collections.push(col);
      }
      if (!col.gameIds.includes(gameId)) col.gameIds.push(gameId);
    }
  }
  writePrefs(prefs);
  return prefs;
}

export async function addCustomGame(): Promise<
  ActionResult & { prefs?: LibraryPrefs; game?: HubGame }
> {
  const picked = await dialog.showOpenDialog({
    title: "Add a game executable",
    properties: ["openFile"],
    filters: [{ name: "Executables", extensions: ["exe"] }],
  });
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: false, error: "Cancelled." };
  }

  const exePath = picked.filePaths[0];
  const base =
    exePath
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.exe$/i, "")
      .replace(/[_-]+/g, " ") ?? "Custom Game";

  const game: HubGame = {
    id: `custom-${Buffer.from(exePath).toString("base64url").slice(0, 24)}`,
    store: "other",
    name: base,
    launchId: `exe:${exePath}`,
    installPath: exePath.replace(/[/\\][^/\\]+$/, ""),
  };

  const prefs = readPrefs();
  prefs.customGames = [
    game,
    ...prefs.customGames.filter((g) => g.launchId !== game.launchId),
  ];
  writePrefs(prefs);
  return { ok: true, message: `Added ${game.name}`, prefs, game };
}

export function removeCustomGame(gameId: string): LibraryPrefs {
  const prefs = readPrefs();
  prefs.customGames = prefs.customGames.filter((g) => g.id !== gameId);
  delete prefs.launchOptions[gameId];
  writePrefs(prefs);
  return prefs;
}
