import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { HubGame } from "../shared/types";
import { resolveCoverViaSteamSearch } from "./covers";

type EpicManifest = {
  bIsIncompleteInstall?: boolean;
  bIsApplication?: boolean;
  DisplayName?: string;
  AppName?: string;
  InstallLocation?: string;
  LaunchExecutable?: string;
  CatalogNamespace?: string;
  CatalogItemId?: string;
  MainGameAppName?: string;
  AppCategories?: string[];
};

function findEpicManifestDir(): string | null {
  const candidates = [
    process.env.PROGRAMDATA
      ? join(process.env.PROGRAMDATA, "Epic", "EpicGamesLauncher", "Data", "Manifests")
      : null,
    "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests",
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function findEpicInstallRoot(): string | null {
  const candidates = [
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Epic Games") : null,
    "C:\\Program Files\\Epic Games",
    "D:\\Epic Games",
    "E:\\Epic Games",
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function isProbablyGame(manifest: EpicManifest): boolean {
  if (manifest.bIsIncompleteInstall) return false;
  if (!manifest.DisplayName || !manifest.AppName) return false;
  if (!manifest.InstallLocation || !existsSync(manifest.InstallLocation)) return false;

  const cats = (manifest.AppCategories ?? []).map((c) => c.toLowerCase());
  if (cats.length > 0 && !cats.some((c) => c.includes("game") || c.includes("application"))) {
    // Still allow if it has a launch executable
    if (!manifest.LaunchExecutable) return false;
  }

  const name = manifest.DisplayName.toLowerCase();
  if (
    name.includes("epic games launcher") ||
    name.includes("unreal engine") ||
    name.startsWith("ue_")
  ) {
    return false;
  }

  return true;
}

export async function scanEpicGames(): Promise<{
  games: HubGame[];
  epicPath: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const manifestDir = findEpicManifestDir();
  const epicPath = findEpicInstallRoot();

  if (!manifestDir) {
    return {
      games: [],
      epicPath,
      errors: ["Epic Games Launcher manifests not found (optional if you only use Steam)."],
    };
  }

  const games: HubGame[] = [];
  const seen = new Set<string>();

  try {
    const files = readdirSync(manifestDir).filter((f) => f.toLowerCase().endsWith(".item"));
    for (const file of files) {
      try {
        const raw = readFileSync(join(manifestDir, file), "utf8");
        const manifest = JSON.parse(raw) as EpicManifest;
        if (!isProbablyGame(manifest)) continue;

        const appName = manifest.AppName!;
        const id = `epic-${appName}`;
        if (seen.has(id)) continue;
        seen.add(id);

        games.push({
          id,
          store: "epic",
          name: manifest.DisplayName!,
          launchId: appName,
          installPath: manifest.InstallLocation,
          catalogNamespace: manifest.CatalogNamespace,
          catalogItemId: manifest.CatalogItemId,
        });
      } catch (err) {
        errors.push(`Epic manifest ${file}: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`Epic scan failed: ${String(err)}`);
  }

  await Promise.all(
    games.map(async (game) => {
      const coverUrls = await resolveCoverViaSteamSearch(game.name);
      if (coverUrls.length === 0) return;
      game.coverUrls = coverUrls;
      game.coverUrl = coverUrls[0];
    }),
  );

  return { games, epicPath: epicPath ?? manifestDir, errors };
}
