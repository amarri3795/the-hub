import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { HubGame } from "../shared/types";

type GogInfo = {
  name?: string;
  gameId?: string;
  playTasks?: { isPrimary?: boolean; path?: string; type?: string }[];
};

function findGogRoots(): string[] {
  const candidates = [
    process.env["PROGRAMFILES(X86)"]
      ? join(process.env["PROGRAMFILES(X86)"], "GOG Galaxy", "Games")
      : null,
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "GOG Galaxy", "Games")
      : null,
    "C:\\GOG Games",
    "D:\\GOG Games",
    "E:\\GOG Games",
    process.env.USERPROFILE ? join(process.env.USERPROFILE, "GOG Games") : null,
  ].filter(Boolean) as string[];

  return candidates.filter((p) => existsSync(p));
}

function walkInfoFiles(root: string, depth = 0, out: string[] = []): string[] {
  if (depth > 4) return out;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(root, name);
    try {
      const st = statSync(full);
      if (st.isFile() && /^goggame-.*\.info$/i.test(name)) out.push(full);
      else if (st.isDirectory() && !name.startsWith(".")) {
        walkInfoFiles(full, depth + 1, out);
      }
    } catch {
      // skip
    }
  }
  return out;
}

export function scanGogGames(): {
  games: HubGame[];
  gogPath: string | null;
  errors: string[];
} {
  const errors: string[] = [];
  const roots = findGogRoots();
  if (roots.length === 0) {
    return {
      games: [],
      gogPath: null,
      errors: ["GOG Games folder not found (optional)."],
    };
  }

  const games: HubGame[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    for (const infoPath of walkInfoFiles(root)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, "utf8")) as GogInfo;
        const name = info.name?.trim();
        if (!name) continue;
        const dir = infoPath.replace(/[/\\][^/\\]+$/, "");
        const primary =
          info.playTasks?.find((t) => t.isPrimary && t.path) ??
          info.playTasks?.find((t) => t.path);
        const exeRel = primary?.path;
        if (!exeRel) continue;
        const exePath = join(dir, exeRel);
        if (!existsSync(exePath)) continue;

        const id = `gog-${info.gameId ?? name}`;
        if (seen.has(id)) continue;
        seen.add(id);

        games.push({
          id,
          store: "gog",
          name,
          launchId: `exe:${exePath}`,
          installPath: dir,
        });
      } catch (err) {
        errors.push(`GOG info parse: ${String(err)}`);
      }
    }
  }

  return { games, gogPath: roots[0] ?? null, errors };
}
