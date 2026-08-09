import { scanSteamGames } from "./steam";
import { scanEpicGames } from "./epic";
import { scanUbisoftGames } from "./ubisoft";
import { scanMinecraftGames } from "./minecraft";
import { scanGogGames } from "./gog";
import { scanXboxGames } from "./xbox";
import { readSteamPlaytimes } from "./playtime";
import { readSteamCategories } from "./steamCategories";
import { readPrefs } from "./prefs";
import { resolveCoverViaSteamSearch } from "./covers";
import type { ScanResult } from "../shared/types";

export async function scanAllLibraries(): Promise<ScanResult> {
  const [steam, epic, ubisoft, minecraft, gog, xbox] = await Promise.all([
    scanSteamGames(),
    scanEpicGames(),
    scanUbisoftGames(),
    scanMinecraftGames(),
    Promise.resolve(scanGogGames()),
    Promise.resolve(scanXboxGames()),
  ]);

  const playtimes = readSteamPlaytimes(steam.steamPath);
  const steamCats = readSteamCategories(steam.steamPath);
  for (const game of steam.games) {
    if (game.launchId && playtimes[game.launchId]) {
      game.playtimeMinutes = playtimes[game.launchId].playtimeMinutes;
      game.lastPlayed = playtimes[game.launchId].lastPlayed;
    }
    if (game.launchId && steamCats[game.launchId]) {
      game.steamCategories = steamCats[game.launchId];
    }
  }

  const prefs = readPrefs();
  const games = [
    ...steam.games,
    ...epic.games,
    ...ubisoft.games,
    ...minecraft.games,
    ...gog.games,
    ...xbox.games,
    ...prefs.customGames,
  ];

  await Promise.all(
    games.map(async (g) => {
      if ((g.coverUrls && g.coverUrls.length > 0) || g.coverUrl) return;
      if (g.store === "steam") return;
      try {
        const urls = await resolveCoverViaSteamSearch(g.name);
        if (urls.length) {
          g.coverUrls = urls;
          g.coverUrl = urls[0];
        }
      } catch {
        // ignore
      }
    }),
  );

  games.sort((a, b) => a.name.localeCompare(b.name));

  const errors = [
    ...steam.errors,
    ...epic.errors,
    ...ubisoft.errors,
    ...minecraft.errors,
    ...gog.errors,
    ...xbox.errors,
  ].filter((e) => {
    if (games.length > 0 && e.toLowerCase().includes("not found")) return false;
    if (games.length > 0 && e.toLowerCase().includes("not detected")) return false;
    return true;
  });

  return {
    games,
    steamPath: steam.steamPath,
    epicPath: epic.epicPath,
    ubisoftPath: ubisoft.ubisoftPath,
    minecraftPath: minecraft.minecraftPath,
    gogPath: gog.gogPath,
    xboxPath: xbox.xboxPath,
    errors,
  };
}
