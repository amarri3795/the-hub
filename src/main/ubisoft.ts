import { existsSync, readdirSync, statSync } from "fs";
import { basename, join, normalize } from "path";
import { execSync } from "child_process";
import type { HubGame } from "../shared/types";
import { resolveCoverViaSteamSearch } from "./covers";

function findUbisoftLauncherPath(): string | null {
  const candidates = [
    process.env["PROGRAMFILES(X86)"]
      ? join(process.env["PROGRAMFILES(X86)"], "Ubisoft", "Ubisoft Game Launcher")
      : null,
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "Ubisoft", "Ubisoft Game Launcher")
      : null,
    "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher",
    "C:\\Program Files\\Ubisoft\\Ubisoft Game Launcher",
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (
      existsSync(join(path, "upc.exe")) ||
      existsSync(join(path, "UbisoftConnect.exe")) ||
      existsSync(join(path, "games"))
    ) {
      return path;
    }
  }

  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher" /v InstallDir',
      { encoding: "utf8" },
    );
    const match = out.match(/InstallDir\s+REG_SZ\s+(.+)/i);
    if (match?.[1]) {
      const path = match[1].trim().replace(/\//g, "\\");
      if (existsSync(path)) return path;
    }
  } catch {
    // ignore
  }

  return null;
}

type RegInstall = { gameId: string; installDir: string };

function readRegistryInstalls(): RegInstall[] {
  const keyPaths = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs",
    "HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs",
  ];
  const byId = new Map<string, RegInstall>();

  for (const key of keyPaths) {
    try {
      const out = execSync(`reg query "${key}" /s`, { encoding: "utf8" });
      let currentId: string | null = null;
      for (const line of out.split(/\r?\n/)) {
        const keyMatch = line.match(/\\Installs\\(\d+)\s*$/i);
        if (keyMatch) {
          currentId = keyMatch[1];
          continue;
        }
        const dirMatch = line.match(/InstallDir\s+REG_SZ\s+(.+)/i);
        if (currentId && dirMatch?.[1]) {
          const installDir = normalize(dirMatch[1].trim().replace(/\//g, "\\"));
          byId.set(currentId, { gameId: currentId, installDir });
          currentId = null;
        }
      }
    } catch {
      // key missing
    }
  }

  return [...byId.values()];
}

function normPath(p: string): string {
  return normalize(p).replace(/[\\/]+$/, "").toLowerCase();
}

function findGameExe(installDir: string): string | undefined {
  if (!existsSync(installDir)) return undefined;
  const skip =
    /crash|redist|uninstall|vcredist|easyanti|battleye|uplay|ubisoftconnect|overlay|dxsetup|dotnet|support[\\/]directx/i;

  const queue = [installDir];
  const found: string[] = [];
  let scanned = 0;

  while (queue.length > 0 && scanned < 400) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      scanned += 1;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!/^(redist|support|__installer|dotnet|directx)$/i.test(ent.name)) {
          queue.push(full);
        }
        continue;
      }
      if (!/\.exe$/i.test(ent.name) || skip.test(full)) continue;
      found.push(full);
    }
  }

  if (found.length === 0) return undefined;
  const folder = basename(installDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  found.sort((a, b) => {
    const score = (p: string) =>
      (p.toLowerCase().includes("\\bin") ? 0 : 2) +
      (basename(p)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .includes(folder.slice(0, 8))
        ? 0
        : 1) +
      p.length / 1000;
    return score(a) - score(b);
  });
  return found[0];
}

function isLikelyInstalledGameDir(dir: string): boolean {
  try {
    const st = statSync(dir);
    if (!st.isDirectory()) return false;
    const entries = readdirSync(dir);
    if (entries.length === 0) return false;
    return entries.length > 1 || !!findGameExe(dir);
  } catch {
    return false;
  }
}

export async function scanUbisoftGames(): Promise<{
  games: HubGame[];
  ubisoftPath: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const ubisoftPath = findUbisoftLauncherPath();

  if (!ubisoftPath) {
    return {
      games: [],
      ubisoftPath: null,
      errors: ["Ubisoft Connect not found (optional)."],
    };
  }

  const games: HubGame[] = [];
  const seenDirs = new Set<string>();
  const regInstalls = readRegistryInstalls();

  for (const install of regInstalls) {
    if (!install.installDir || !existsSync(install.installDir)) continue;
    const key = normPath(install.installDir);
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);

    const name =
      basename(install.installDir.replace(/[\\/]+$/, "")) ||
      `Ubisoft ${install.gameId}`;

    games.push({
      id: `ubisoft-${install.gameId}`,
      store: "ubisoft",
      name,
      launchId: install.gameId,
      installPath: install.installDir,
    });
  }

  const gamesRoot = join(ubisoftPath, "games");
  if (existsSync(gamesRoot)) {
    try {
      for (const ent of readdirSync(gamesRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const installDir = join(gamesRoot, ent.name);
        const key = normPath(installDir);
        if (seenDirs.has(key)) continue;
        if (!isLikelyInstalledGameDir(installDir)) continue;
        seenDirs.add(key);

        const exe = findGameExe(installDir);
        games.push({
          id: `ubisoft-dir-${ent.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}`,
          store: "ubisoft",
          name: ent.name,
          launchId: exe ? `exe:${exe}` : undefined,
          installPath: installDir,
        });
      }
    } catch (err) {
      errors.push(`Ubisoft games folder error: ${String(err)}`);
    }
  }

  await Promise.all(
    games.map(async (game) => {
      const coverUrls = await resolveCoverViaSteamSearch(game.name);
      if (coverUrls.length === 0) return;
      game.coverUrls = coverUrls;
      game.coverUrl = coverUrls[0];
    }),
  );

  return { games, ubisoftPath, errors };
}
