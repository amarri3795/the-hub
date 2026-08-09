import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { HubGame } from "../shared/types";
import { buildSteamCoverUrls, resolveSteamHeaderCover } from "./covers";

function parseVdfValue(block: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s+"([^"]*)"`, "i");
  const match = block.match(re);
  return match?.[1] ?? null;
}

export function findSteamPath(): string | null {
  const candidates = [
    process.env["PROGRAMFILES(X86)"]
      ? join(process.env["PROGRAMFILES(X86)"], "Steam")
      : null,
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Steam") : null,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Programs", "Steam")
      : null,
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (existsSync(join(path, "steam.exe")) || existsSync(join(path, "steamapps"))) {
      return path;
    }
  }

  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
      { encoding: "utf8" },
    );
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match?.[1]) {
      const path = match[1].trim().replace(/\//g, "\\");
      if (existsSync(path)) return path;
    }
  } catch {
    // ignore
  }

  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
      { encoding: "utf8" },
    );
    const match = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
    if (match?.[1]) {
      const path = match[1].trim();
      if (existsSync(path)) return path;
    }
  } catch {
    // ignore
  }

  return null;
}

function readLibraryFolders(steamPath: string): string[] {
  const folders = new Set<string>([join(steamPath, "steamapps")]);
  const vdfPath = join(steamPath, "steamapps", "libraryfolders.vdf");
  if (!existsSync(vdfPath)) return [...folders];

  try {
    const text = readFileSync(vdfPath, "utf8");
    const pathMatches = text.matchAll(/"(?:path|Path)"\s+"([^"]+)"/g);
    for (const m of pathMatches) {
      const libraryRoot = m[1].replace(/\\\\/g, "\\");
      const steamapps = join(libraryRoot, "steamapps");
      if (existsSync(steamapps)) folders.add(steamapps);
    }
  } catch {
    // ignore
  }

  return [...folders];
}

function parseAppManifest(
  filePath: string,
  steamPath: string,
): HubGame | null {
  try {
    const text = readFileSync(filePath, "utf8");
    const appId = parseVdfValue(text, "appid");
    const name = parseVdfValue(text, "name");
    const installdir = parseVdfValue(text, "installdir");
    if (!appId || !name) return null;

    const lower = name.toLowerCase();
    if (
      lower.includes("steamworks common") ||
      lower.includes("redistributable") ||
      lower.startsWith("proton ")
    ) {
      return null;
    }

    const steamappsDir = filePath.replace(/[\\/][^\\/]+$/, "");
    const installPath = installdir
      ? join(steamappsDir, "common", installdir)
      : undefined;

    const coverUrls = buildSteamCoverUrls(steamPath, appId);

    return {
      id: `steam-${appId}`,
      store: "steam",
      launchId: appId,
      name,
      installPath:
        installPath && existsSync(installPath) ? installPath : undefined,
      coverUrl: coverUrls[0],
      coverUrls,
    };
  } catch {
    return null;
  }
}

export async function scanSteamGames(): Promise<{
  games: HubGame[];
  steamPath: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const steamPath = findSteamPath();

  if (!steamPath) {
    return {
      games: [],
      steamPath: null,
      errors: ["Steam not found (optional if you only use Epic)."],
    };
  }

  const games: HubGame[] = [];
  const seen = new Set<string>();

  for (const folder of readLibraryFolders(steamPath)) {
    try {
      const files = readdirSync(folder).filter((f) =>
        /^appmanifest_\d+\.acf$/i.test(f),
      );
      for (const file of files) {
        const game = parseAppManifest(join(folder, file), steamPath);
        if (!game || seen.has(game.id)) continue;
        seen.add(game.id);
        games.push(game);
      }
    } catch (err) {
      errors.push(`Steam library error (${folder}): ${String(err)}`);
    }
  }

  // Append API header/capsule URLs only as last-resort fallbacks (never ahead of portraits).
  await Promise.all(
    games.map(async (game) => {
      if (!game.launchId) return;
      const hasLocalPortrait = (game.coverUrls ?? []).some(
        (u) =>
          u.startsWith("hubimg://") &&
          (u.includes("library_600x900") || u.includes("library_capsule")),
      );
      if (hasLocalPortrait) return;
      const headerUrls = await resolveSteamHeaderCover(game.launchId);
      if (headerUrls.length === 0) return;
      const merged = [...(game.coverUrls ?? []), ...headerUrls];
      const unique = [...new Set(merged)];
      game.coverUrls = unique;
      game.coverUrl = unique[0];
    }),
  );

  return { games, steamPath, errors };
}
