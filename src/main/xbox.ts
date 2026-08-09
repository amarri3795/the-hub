import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { HubGame } from "../shared/types";

type StartApp = { Name?: string; AppID?: string };

const SKIP_NAME =
  /settings|xbox|microsoft store|calculator|photos|mail|edge|outlook|teams|onedrive|clipchamp|solitaire|minecraft|copilot|widgets|phone link|feedback|tips|get help|paint|notepad|clock|maps|weather|news|media player|terminal|powershell|cmd|store|installer|update|runtime|redistributable/i;

const GAME_HINT =
  /assassin|forza|halo|sea of thieves|flight sim|racing|soccer|football|warhammer|quest|legends|idle|rpg|call of|destiny|diablo|elder scrolls|fallout|gear|battlefield|overwatch|rocket league|age of|civilization|tomb raider|resident evil|street fighter|tekken|nba|madden|f1 |gran turismo|spider-man|god of war|horizon|hellblade|ori |cuphead|hades|starfield|doom|wolfenstein|gta|red dead|far cry|watch dogs|rainbow six|the division|avatar|prince of|uno\b|south park|anno /i;

function findXboxGamesFolder(): string | null {
  const candidates = [
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Microsoft", "XboxGames")
      : null,
    "C:\\XboxGames",
    "D:\\XboxGames",
    "E:\\XboxGames",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findPrimaryExe(dir: string): string | null {
  try {
    const entries = readdirSync(dir);
    const exes = entries
      .filter((n) => /\.exe$/i.test(n))
      .filter((n) => !/crash|redis|vc_redist|unins|setup|launcher_helper/i.test(n));
    if (exes[0]) return join(dir, exes[0]);
    for (const n of entries) {
      const full = join(dir, n);
      try {
        if (statSync(full).isDirectory()) {
          const nested = findPrimaryExe(full);
          if (nested) return nested;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return null;
}

export function scanXboxGames(): {
  games: HubGame[];
  xboxPath: string | null;
  errors: string[];
} {
  const errors: string[] = [];
  const games: HubGame[] = [];
  const seen = new Set<string>();
  const xboxPath = findXboxGamesFolder();

  if (xboxPath) {
    try {
      for (const name of readdirSync(xboxPath)) {
        if (/minecraft/i.test(name)) continue;
        const content = join(xboxPath, name, "Content");
        if (!existsSync(content)) continue;
        const id = `xbox-folder-${name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const exe = findPrimaryExe(content);
        games.push({
          id,
          store: "xbox",
          name: name.replace(/[_-]+/g, " "),
          launchId: exe ? `exe:${exe}` : "protocol:msxbox://games",
          installPath: content,
        });
      }
    } catch (err) {
      errors.push(`Xbox folder scan: ${String(err)}`);
    }
  }

  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-StartApps | ConvertTo-Json -Compress"',
      { encoding: "utf8", timeout: 20000, windowsHide: true },
    );
    const parsed = JSON.parse(raw) as StartApp | StartApp[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const app of list) {
      const name = app.Name?.trim();
      const appId = app.AppID?.trim();
      if (!name || !appId) continue;
      if (!appId.includes("!")) continue;
      if (SKIP_NAME.test(name)) continue;

      const publisherHint =
        /Xbox|Gaming|Bethesda|Ubisoft|ElectronicArts|EAStudio|Activision|Blizzard|SEGA|SquareEnix|Capcom|Bandai|Warner|2K|Rockstar|CDPROJEKT/i.test(
          appId,
        );
      if (!publisherHint && !GAME_HINT.test(name)) continue;

      const id = `xbox-app-${appId}`;
      if (seen.has(id)) continue;
      // Avoid dupes of folder titles
      if (
        games.some(
          (g) =>
            g.store === "xbox" &&
            g.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        continue;
      }
      seen.add(id);
      games.push({
        id,
        store: "xbox",
        name,
        launchId: `appx:${appId}`,
      });
    }
  } catch (err) {
    errors.push(`Xbox StartApps scan: ${String(err)}`);
  }

  if (games.length === 0 && !xboxPath) {
    errors.push("Xbox / Game Pass titles not detected (optional).");
  }

  return { games, xboxPath, errors };
}
