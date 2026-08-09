import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { HubGame } from "../shared/types";

/** Stable portrait cover (Minecraft Java on Steam as art fallback). */
const MINECRAFT_COVER =
  "https://cdn.cloudflare.steamstatic.com/steam/apps/1672970/library_600x900.jpg";

function covers(): { coverUrl: string; coverUrls: string[] } {
  return {
    coverUrl: MINECRAFT_COVER,
    coverUrls: [MINECRAFT_COVER],
  };
}

function hasDotMinecraft(): boolean {
  const dir = process.env.APPDATA
    ? join(process.env.APPDATA, ".minecraft")
    : null;
  return !!dir && existsSync(dir);
}

function findPackageDir(pattern: RegExp): string | null {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const pkgRoot = join(local, "Packages");
  if (!existsSync(pkgRoot)) return null;
  try {
    for (const ent of readdirSync(pkgRoot, { withFileTypes: true })) {
      if (ent.isDirectory() && pattern.test(ent.name)) return ent.name;
    }
  } catch {
    // ignore
  }
  return null;
}

function readStartAppIds(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-StartApps | Where-Object { $_.Name -match \'Minecraft\' } | ForEach-Object { $_.Name + \'`t\' + $_.AppID }"',
      { encoding: "utf8", windowsHide: true },
    );
    for (const line of out.split(/\r?\n/)) {
      const [name, appId] = line.split("\t");
      if (name && appId) map.set(name.trim(), appId.trim());
    }
  } catch {
    // ignore
  }
  return map;
}

/**
 * At most two entries: Java Edition and/or Bedrock.
 * Avoids launcher + Prism + Modrinth + Xbox duplicates flooding the library.
 */
export async function scanMinecraftGames(): Promise<{
  games: HubGame[];
  minecraftPath: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const games: HubGame[] = [];
  const startApps = readStartAppIds();

  const javaPkg = findPackageDir(/Microsoft\.MinecraftJavaEdition_/i);
  const bedrockPkg = findPackageDir(/Microsoft\.MinecraftUWP_/i);
  const hasJavaData =
    hasDotMinecraft() ||
    !!javaPkg ||
    [...startApps.keys()].some((n) => /java edition/i.test(n));

  const javaAppId =
    [...startApps.entries()].find(([n]) => /java edition/i.test(n))?.[1] ??
    (javaPkg ? `${javaPkg}!Game` : null);

  const bedrockAppId =
    [...startApps.entries()].find(([n]) =>
      /minecraft for windows|bedrock/i.test(n),
    )?.[1] ?? (bedrockPkg ? `${bedrockPkg}!Game` : null);

  const launcherAppId =
    [...startApps.entries()].find(([n]) => /^minecraft launcher$/i.test(n))?.[1] ??
    null;

  let minecraftPath: string | null = null;
  if (process.env.APPDATA && hasDotMinecraft()) {
    minecraftPath = join(process.env.APPDATA, ".minecraft");
  } else if (javaPkg && process.env.LOCALAPPDATA) {
    minecraftPath = join(process.env.LOCALAPPDATA, "Packages", javaPkg);
  } else if (bedrockPkg && process.env.LOCALAPPDATA) {
    minecraftPath = join(process.env.LOCALAPPDATA, "Packages", bedrockPkg);
  }

  if (hasJavaData || javaAppId) {
    games.push({
      id: "minecraft-java",
      store: "minecraft",
      name: "Minecraft: Java Edition",
      launchId: javaAppId ? `appx:${javaAppId}` : "protocol:minecraft:",
      installPath: minecraftPath ?? undefined,
      ...covers(),
    });
  }

  if (bedrockAppId || bedrockPkg) {
    games.push({
      id: "minecraft-bedrock",
      store: "minecraft",
      name: "Minecraft for Windows",
      launchId: bedrockAppId
        ? `appx:${bedrockAppId}`
        : "appx:Microsoft.MinecraftUWP_8wekyb3d8bbwe!Game",
      installPath:
        bedrockPkg && process.env.LOCALAPPDATA
          ? join(process.env.LOCALAPPDATA, "Packages", bedrockPkg)
          : undefined,
      ...covers(),
    });
  }

  // Only if we found neither edition — show the launcher once.
  if (games.length === 0 && launcherAppId) {
    games.push({
      id: "minecraft-launcher",
      store: "minecraft",
      name: "Minecraft Launcher",
      launchId: `appx:${launcherAppId}`,
      installPath: minecraftPath ?? undefined,
      ...covers(),
    });
  }

  if (games.length === 0) {
    errors.push("Minecraft not detected (optional).");
  }

  return { games, minecraftPath, errors };
}
