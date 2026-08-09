import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

/** Read Steam user categories/tags from sharedconfig.vdf / localconfig.vdf. */
export function readSteamCategories(
  steamPath: string | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!steamPath) return out;

  const userdata = join(steamPath, "userdata");
  if (!existsSync(userdata)) return out;

  let users: string[] = [];
  try {
    users = readdirSync(userdata).filter((id) => /^\d+$/.test(id) && id !== "0");
  } catch {
    return out;
  }

  for (const user of users) {
    const candidates = [
      join(userdata, user, "7", "remote", "sharedconfig.vdf"),
      join(userdata, user, "config", "localconfig.vdf"),
    ];
    for (const file of candidates) {
      if (!existsSync(file)) continue;
      let text = "";
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }

      // "apps" { "570" { "tags" { "0" "Multiplayer" } } }
      const appBlocks = text.matchAll(
        /"(\d{3,})"\s*\{([\s\S]*?)(?=\n\s*"\d{3,}"\s*\{|\n\s*\}\s*\n\s*"apps"|\n\s*\}\s*$)/g,
      );
      for (const m of appBlocks) {
        const appId = m[1];
        const body = m[2];
        const tagsBlock = body.match(/"tags"\s*\{([\s\S]*?)\}/i);
        if (!tagsBlock) continue;
        const tags = [...tagsBlock[1].matchAll(/"\d+"\s+"([^"]+)"/g)].map(
          (t) => t[1].trim(),
        );
        if (!tags.length) continue;
        const prev = out[appId] ?? [];
        out[appId] = [...new Set([...prev, ...tags])];
      }
    }
  }

  return out;
}
