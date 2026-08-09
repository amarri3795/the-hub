import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export type SteamPlaytimeMap = Record<
  string,
  { playtimeMinutes: number; lastPlayed?: number }
>;

function findUserdataRoots(steamPath: string): string[] {
  const userdata = join(steamPath, "userdata");
  if (!existsSync(userdata)) return [];
  try {
    return readdirSync(userdata)
      .filter((id) => /^\d+$/.test(id) && id !== "0")
      .map((id) => join(userdata, id));
  } catch {
    return [];
  }
}

/** Parse Playtime / LastPlayed from localconfig.vdf app blocks. */
export function readSteamPlaytimes(steamPath: string | null): SteamPlaytimeMap {
  const map: SteamPlaytimeMap = {};
  if (!steamPath) return map;

  for (const userRoot of findUserdataRoots(steamPath)) {
    const cfg = join(userRoot, "config", "localconfig.vdf");
    if (!existsSync(cfg)) continue;
    let text = "";
    try {
      text = readFileSync(cfg, "utf8");
    } catch {
      continue;
    }

    // Match "123456" { ... Playtime "N" ... }
    const appBlocks = text.matchAll(
      /"(\d{3,})"\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
    );
    for (const m of appBlocks) {
      const appId = m[1];
      const body = m[2];
      const play = body.match(/"Playtime"\s+"(\d+)"/i);
      const last = body.match(/"LastPlayed"\s+"(\d+)"/i);
      if (!play && !last) continue;
      const minutes = play ? Number(play[1]) : 0;
      const lastPlayed = last ? Number(last[1]) * 1000 : undefined;
      const prev = map[appId];
      if (!prev || minutes > prev.playtimeMinutes) {
        map[appId] = {
          playtimeMinutes: minutes,
          lastPlayed: lastPlayed ?? prev?.lastPlayed,
        };
      }
    }
  }

  return map;
}

export function formatPlaytime(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
