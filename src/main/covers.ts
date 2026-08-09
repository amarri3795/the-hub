import { existsSync, readdirSync } from "fs";
import { join } from "path";

const PORTRAIT_LOCAL_NAMES = [
  "library_600x900.jpg",
  "library_capsule.jpg",
];

const LANDSCAPE_LOCAL_NAMES = [
  "library_header.jpg",
  "header.jpg",
  "library_hero.jpg",
  "capsule_616x353.jpg",
];

const PORTRAIT_REMOTE_FILES = ["library_600x900.jpg", "library_capsule.jpg"];

const LANDSCAPE_REMOTE_FILES = [
  "header.jpg",
  "library_hero.jpg",
  "capsule_616x353.jpg",
  "library_header.jpg",
];

const STEAM_CDN_HOSTS = [
  "https://cdn.cloudflare.steamstatic.com/steam/apps",
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps",
  "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps",
  "https://steamcdn-a.akamaihd.net/steam/apps",
  "https://cdn.akamai.steamstatic.com/steam/apps",
];

function hubimgUrl(filePath: string): string {
  return `hubimg://cover/?path=${encodeURIComponent(filePath)}`;
}

function pushUnique(list: string[], value: string | null | undefined): void {
  if (!value || list.includes(value)) return;
  list.push(value);
}

function tryLocalNamed(
  urls: string[],
  steamPath: string,
  appId: string,
  names: string[],
): void {
  const cacheRoot = join(steamPath, "appcache", "librarycache");
  if (!existsSync(cacheRoot)) return;

  const appDir = join(cacheRoot, appId);
  const tryFile = (filePath: string) => {
    if (existsSync(filePath)) pushUnique(urls, hubimgUrl(filePath));
  };

  for (const name of names) {
    tryFile(join(cacheRoot, `${appId}_${name}`));
    tryFile(join(appDir, name));
  }

  if (!existsSync(appDir)) return;
  try {
    for (const ent of readdirSync(appDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      for (const name of names) {
        tryFile(join(appDir, ent.name, name));
      }
    }
  } catch {
    // ignore unreadable cache dirs
  }
}

function findLocalSteamCoverUrlsByKind(
  steamPath: string,
  appId: string,
  kind: "portrait" | "landscape",
): string[] {
  const urls: string[] = [];
  const names =
    kind === "portrait" ? PORTRAIT_LOCAL_NAMES : LANDSCAPE_LOCAL_NAMES;
  tryLocalNamed(urls, steamPath, appId, names);
  return urls;
}

function steamRemoteCoverUrlsByKind(
  appId: string,
  kind: "portrait" | "landscape",
): string[] {
  const files =
    kind === "portrait" ? PORTRAIT_REMOTE_FILES : LANDSCAPE_REMOTE_FILES;
  const urls: string[] = [];
  for (const file of files) {
    for (const host of STEAM_CDN_HOSTS) {
      pushUnique(urls, `${host}/${appId}/${file}`);
    }
  }
  return urls;
}

/** Portrait-first cover candidates: local portrait → remote portrait → local landscape → remote landscape. */
export function buildSteamCoverUrls(steamPath: string, appId: string): string[] {
  const urls: string[] = [];
  for (const u of findLocalSteamCoverUrlsByKind(steamPath, appId, "portrait")) {
    pushUnique(urls, u);
  }
  for (const u of steamRemoteCoverUrlsByKind(appId, "portrait")) {
    pushUnique(urls, u);
  }
  for (const u of findLocalSteamCoverUrlsByKind(steamPath, appId, "landscape")) {
    pushUnique(urls, u);
  }
  for (const u of steamRemoteCoverUrlsByKind(appId, "landscape")) {
    pushUnique(urls, u);
  }
  return urls;
}

export function steamRemoteCoverUrls(appId: string): string[] {
  const urls: string[] = [];
  for (const u of steamRemoteCoverUrlsByKind(appId, "portrait")) {
    pushUnique(urls, u);
  }
  for (const u of steamRemoteCoverUrlsByKind(appId, "landscape")) {
    pushUnique(urls, u);
  }
  return urls;
}

type StoreSearchResponse = {
  total?: number;
  items?: Array<{
    id?: number;
    name?: string;
    tiny_image?: string;
  }>;
};

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesLooselyMatch(query: string, candidate: string): boolean {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return false;
  if (c === q || c.includes(q) || q.includes(c)) return true;
  const qParts = q.split(/\s+/).filter((p) => p.length > 2);
  if (qParts.length === 0) return false;
  return qParts.every((p) => c.includes(p));
}

function scoreNameMatch(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return -1;
  if (c === q) return 100;
  if (c.startsWith(q) || q.startsWith(c)) return 80;
  if (c.includes(q) || q.includes(c)) return 60;
  const qParts = q.split(/\s+/).filter((p) => p.length > 2);
  if (qParts.length > 0 && qParts.every((p) => c.includes(p))) return 40;
  return -1;
}

/** Best-effort cover for Epic/Ubisoft/other titles via Steam store search. */
export async function resolveCoverViaSteamSearch(
  gameName: string,
): Promise<string[]> {
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as StoreSearchResponse;
    const ranked = (data.items ?? [])
      .filter((it) => typeof it.id === "number")
      .map((it) => ({
        id: it.id as number,
        name: it.name ?? "",
        tiny_image: it.tiny_image,
        score: scoreNameMatch(gameName, it.name ?? ""),
      }))
      .filter((it) => it.score >= 40)
      .sort((a, b) => b.score - a.score);
    const item = ranked[0];
    if (!item) return [];

    // Prefer library portrait art for the matched appId; landscape only as fallback.
    const urls = steamRemoteCoverUrls(String(item.id));

    try {
      const detailsRes = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${item.id}&filters=basic`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (detailsRes.ok) {
        const details = (await detailsRes.json()) as Record<
          string,
          {
            success?: boolean;
            data?: { header_image?: string; capsule_image?: string };
          }
        >;
        const detail = details[String(item.id)]?.data;
        // Append only — never put landscape header ahead of library portraits.
        if (detail?.header_image) pushUnique(urls, detail.header_image);
        if (detail?.capsule_image) pushUnique(urls, detail.capsule_image);
      }
    } catch {
      // ignore
    }

    // Tiny search thumbnails last (often landscape/low quality).
    if (item.tiny_image) pushUnique(urls, item.tiny_image);

    return urls;
  } catch {
    return [];
  }
}

/** Landscape/API assets only — append behind portrait candidates, never prefer. */
export async function resolveSteamHeaderCover(appId: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const details = (await res.json()) as Record<
      string,
      {
        success?: boolean;
        data?: { header_image?: string; capsule_image?: string };
      }
    >;
    const data = details[appId]?.data;
    const urls: string[] = [];
    if (data?.header_image) pushUnique(urls, data.header_image);
    if (data?.capsule_image) pushUnique(urls, data.capsule_image);
    return urls;
  } catch {
    return [];
  }
}

export function isLikelyLandscapeCoverUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (
    lower.includes("library_600x900") ||
    lower.includes("library_capsule")
  ) {
    return false;
  }
  return (
    lower.includes("header.jpg") ||
    lower.includes("library_hero") ||
    lower.includes("library_header") ||
    lower.includes("capsule_616x353") ||
    lower.includes("capsule_231x87") ||
    lower.includes("/capsules/") ||
    lower.includes("header_image")
  );
}
