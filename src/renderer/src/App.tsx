import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GameExtras,
  GridDensity,
  HubGame,
  LaunchOptions,
  LibraryPrefs,
  SortBy,
  StoreId,
  UpdateStatus,
} from "../../shared/types";
import { TitleBar } from "./components/TitleBar";
import hubMark from "./assets/hub-mark.svg";

type StoreFilter = "all" | StoreId;
type ViewFilter = "all" | "favorites" | "recent" | "hidden" | `collection:${string}`;
type CoverFit = "cover" | "contain";

const ACCENTS = [
  { id: "blue", color: "#3d8bfd", label: "Blue" },
  { id: "teal", color: "#2dd4bf", label: "Teal" },
  { id: "amber", color: "#f5a524", label: "Amber" },
  { id: "rose", color: "#fb7185", label: "Rose" },
  { id: "lime", color: "#a3e635", label: "Lime" },
] as const;

function formatPlaytime(minutes?: number): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function isLikelyLandscapeCoverUrl(url: string): boolean {
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
    lower.includes("/capsules/")
  );
}

function coverCandidates(game: HubGame): string[] {
  const list: string[] = [];
  for (const u of game.coverUrls ?? []) list.push(u);
  if (game.coverUrl) list.push(game.coverUrl);
  if (game.store === "steam" && game.launchId && /^\d+$/.test(game.launchId)) {
    const id = game.launchId;
    list.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
      `https://steamcdn-a.akamaihd.net/steam/apps/${id}/library_600x900.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_capsule.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`,
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
      `https://steamcdn-a.akamaihd.net/steam/apps/${id}/header.jpg`,
    );
  }
  return [...new Set(list.filter(Boolean))];
}

function Cover({ game }: { game: HubGame }) {
  const candidates = useMemo(
    () => coverCandidates(game),
    [game.id, game.coverUrl, game.coverUrls, game.store, game.launchId],
  );
  const [index, setIndex] = useState(0);
  const [fit, setFit] = useState<CoverFit>("cover");

  useEffect(() => {
    setIndex(0);
    const first = candidates[0];
    setFit(first && isLikelyLandscapeCoverUrl(first) ? "contain" : "cover");
  }, [game.id, candidates]);

  const src = candidates[index];
  if (!src) {
    return (
      <div className={`cover fallback store-${game.store}`}>
        <span className="fallback-letter">{game.name.slice(0, 1)}</span>
        <span className="fallback-store">{storeLabel(game.store)}</span>
      </div>
    );
  }

  return (
    <img
      className={`cover fit-${fit}`}
      src={src}
      alt=""
      loading="lazy"
      onLoad={(e) => {
        const img = e.currentTarget;
        if (!img.naturalWidth || !img.naturalHeight) return;
        const ratio = img.naturalWidth / img.naturalHeight;
        setFit(ratio < 0.85 ? "cover" : "contain");
      }}
      onError={() => {
        setIndex((i) => {
          const next = i + 1;
          const nextSrc = candidates[next];
          if (nextSrc && isLikelyLandscapeCoverUrl(nextSrc)) {
            setFit("contain");
          }
          return next;
        });
      }}
    />
  );
}

function storeLabel(store: StoreId): string {
  if (store === "steam") return "Steam";
  if (store === "epic") return "Epic";
  if (store === "ubisoft") return "Ubisoft";
  if (store === "minecraft") return "Minecraft";
  if (store === "gog") return "GOG";
  if (store === "xbox") return "Xbox";
  return "Other";
}

function storeSortKey(store: StoreId): number {
  const order: StoreId[] = [
    "steam",
    "epic",
    "ubisoft",
    "gog",
    "xbox",
    "minecraft",
    "other",
  ];
  return order.indexOf(store);
}

export default function App() {
  const [games, setGames] = useState<HubGame[]>([]);
  const [steamPath, setSteamPath] = useState<string | null>(null);
  const [epicPath, setEpicPath] = useState<string | null>(null);
  const [ubisoftPath, setUbisoftPath] = useState<string | null>(null);
  const [minecraftPath, setMinecraftPath] = useState<string | null>(null);
  const [gogPath, setGogPath] = useState<string | null>(null);
  const [xboxPath, setXboxPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [bigPicture, setBigPicture] = useState(false);
  const [prefs, setPrefs] = useState<LibraryPrefs | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<HubGame | null>(null);
  const [extras, setExtras] = useState<GameExtras | null>(null);
  const [notes, setNotes] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [launchDraft, setLaunchDraft] = useState<LaunchOptions>({});
  const [collectionName, setCollectionName] = useState("");
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  const sortBy = prefs?.sortBy ?? "name";
  const density = prefs?.gridDensity ?? "comfortable";
  const accent = prefs?.accentColor ?? "#3d8bfd";

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const [result, nextPrefs] = await Promise.all([
        window.hub.scanLibrary(),
        window.hub.getPrefs(),
      ]);
      setGames(result.games);
      setSteamPath(result.steamPath);
      setEpicPath(result.epicPath);
      setUbisoftPath(result.ubisoftPath);
      setMinecraftPath(result.minecraftPath);
      setGogPath(result.gogPath);
      setXboxPath(result.xboxPath);
      setErrors(result.errors);
      setPrefs(nextPrefs);
    } catch (err) {
      setErrors([String(err)]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void window.hub.getUpdateStatus().then(setUpdateStatus);
    const offStatus = window.hub.onUpdateStatus(setUpdateStatus);
    const offCheck = window.hub.onRequestUpdateCheck(() => {
      void window.hub.checkUpdates().then(setUpdateStatus);
    });
    return () => {
      offStatus();
      offCheck();
    };
  }, [refresh]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);

  const loadExtras = useCallback(async (game: HubGame) => {
    setExtrasLoading(true);
    try {
      const data = await window.hub.getExtras(game.id, game.name);
      setExtras(data);
      setNotes(data.notes);
      setTagDraft(data.tags.join(", "));
      setLaunchDraft({ ...data.launchOptions });
    } finally {
      setExtrasLoading(false);
    }
  }, []);

  async function selectGame(game: HubGame) {
    setSelected(game);
    await loadExtras(game);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fav = new Set(prefs?.favorites ?? []);
    const hidden = new Set(prefs?.hidden ?? []);
    const recentOrder = new Map(
      (prefs?.recent ?? []).map((r, i) => [r.id, i] as const),
    );
    const collectionId = viewFilter.startsWith("collection:")
      ? viewFilter.slice("collection:".length)
      : null;
    const collection = collectionId
      ? prefs?.collections.find((c) => c.id === collectionId)
      : null;
    const inCollection = new Set(collection?.gameIds ?? []);

    let list = games.filter((g) => {
      if (storeFilter !== "all" && g.store !== storeFilter) return false;
      if (viewFilter === "favorites" && !fav.has(g.id)) return false;
      if (viewFilter === "hidden") return hidden.has(g.id);
      if (viewFilter !== "hidden" && hidden.has(g.id)) return false;
      if (viewFilter === "recent") return recentOrder.has(g.id);
      if (collectionId && !inCollection.has(g.id)) return false;
      if (q) {
        const tags = prefs?.tags[g.id] ?? [];
        const cats = g.steamCategories ?? [];
        const hitName = g.name.toLowerCase().includes(q);
        const hitTag = tags.some((t) => t.toLowerCase().includes(q));
        const hitCat = cats.some((t) => t.toLowerCase().includes(q));
        if (!hitName && !hitTag && !hitCat) return false;
      }
      return true;
    });

    const byName = (a: HubGame, b: HubGame) => a.name.localeCompare(b.name);

    if (viewFilter === "recent") {
      list = [...list].sort(
        (a, b) => (recentOrder.get(a.id) ?? 99) - (recentOrder.get(b.id) ?? 99),
      );
    } else if (sortBy === "recent") {
      list = [...list].sort((a, b) => {
        const ra = recentOrder.has(a.id) ? (recentOrder.get(a.id) ?? 99) : 999;
        const rb = recentOrder.has(b.id) ? (recentOrder.get(b.id) ?? 99) : 999;
        if (ra !== rb) return ra - rb;
        const la = a.lastPlayed ?? 0;
        const lb = b.lastPlayed ?? 0;
        if (la !== lb) return lb - la;
        return byName(a, b);
      });
    } else if (sortBy === "playtime") {
      list = [...list].sort((a, b) => {
        const pa = a.playtimeMinutes ?? 0;
        const pb = b.playtimeMinutes ?? 0;
        if (pa !== pb) return pb - pa;
        return byName(a, b);
      });
    } else if (sortBy === "store") {
      list = [...list].sort((a, b) => {
        const sa = storeSortKey(a.store);
        const sb = storeSortKey(b.store);
        if (sa !== sb) return sa - sb;
        return byName(a, b);
      });
    } else {
      list = [...list].sort(byName);
    }

    return list;
  }, [games, query, storeFilter, viewFilter, prefs, sortBy]);

  useEffect(() => {
    setFocusIndex(0);
    cardRefs.current = [];
  }, [filtered.length, viewFilter, storeFilter, query, density, bigPicture]);

  useEffect(() => {
    if (!bigPicture) return;
    cardRefs.current[focusIndex]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [focusIndex, bigPicture]);

  useEffect(() => {
    if (!bigPicture) return;

    const onKey = (e: KeyboardEvent) => {
      if (!filtered.length) return;
      const cols =
        density === "compact" ? 8 : density === "big" || bigPicture ? 4 : 5;
      let next = focusIndex;

      if (e.key === "ArrowRight" || e.key === "d") next = focusIndex + 1;
      else if (e.key === "ArrowLeft" || e.key === "a") next = focusIndex - 1;
      else if (e.key === "ArrowDown" || e.key === "s") next = focusIndex + cols;
      else if (e.key === "ArrowUp" || e.key === "w") next = focusIndex - cols;
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const game = filtered[focusIndex];
        if (game) void launch(game);
        return;
      } else if (e.key === "Escape") {
        setBigPicture(false);
        return;
      } else {
        return;
      }

      e.preventDefault();
      next = Math.max(0, Math.min(filtered.length - 1, next));
      setFocusIndex(next);
    };

    const prev = { up: false, down: false, left: false, right: false, a: false, b: false };
    const onPad = () => {
      const pads = navigator.getGamepads?.() ?? [];
      for (const pad of pads) {
        if (!pad) continue;
        const up = !!pad.buttons[12]?.pressed || pad.axes[1] < -0.55;
        const down = !!pad.buttons[13]?.pressed || pad.axes[1] > 0.55;
        const left = !!pad.buttons[14]?.pressed || pad.axes[0] < -0.55;
        const right = !!pad.buttons[15]?.pressed || pad.axes[0] > 0.55;
        const a = !!pad.buttons[0]?.pressed;
        const b = !!pad.buttons[1]?.pressed;
        const cols =
          density === "compact" ? 8 : density === "big" || bigPicture ? 4 : 5;

        if (up && !prev.up) setFocusIndex((i) => Math.max(0, i - cols));
        if (down && !prev.down)
          setFocusIndex((i) => Math.min(filtered.length - 1, i + cols));
        if (left && !prev.left) setFocusIndex((i) => Math.max(0, i - 1));
        if (right && !prev.right)
          setFocusIndex((i) => Math.min(filtered.length - 1, i + 1));
        if (a && !prev.a) {
          const game = filtered[focusIndex];
          if (game) void launch(game);
        }
        if (b && !prev.b) setBigPicture(false);

        prev.up = up;
        prev.down = down;
        prev.left = left;
        prev.right = right;
        prev.a = a;
        prev.b = b;
      }
    };

    window.addEventListener("keydown", onKey);
    const padTimer = window.setInterval(onPad, 100);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearInterval(padTimer);
    };
  }, [bigPicture, filtered, focusIndex, density]);

  async function launch(game: HubGame) {
    setStatus(`Launching ${game.name}…`);
    const result = await window.hub.launchGame(game);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setStatus(`Started ${game.name} via ${storeLabel(game.store)}`);
    setPrefs(await window.hub.getPrefs());
  }

  async function runAction(
    action: () => Promise<{ ok: boolean; error?: string; message?: string }>,
  ) {
    if (!selected) return;
    const result = await action();
    setStatus(result.ok ? result.message ?? "Done." : result.error ?? "Failed.");
    await loadExtras(selected);
    setPrefs(await window.hub.getPrefs());
  }

  async function patchSettings(
    patch: Partial<{
      sortBy: SortBy;
      gridDensity: GridDensity;
      accentColor: string;
      closeToTray: boolean;
    }>,
  ) {
    const next = await window.hub.updateSettings(patch);
    setPrefs(next);
  }

  return (
    <div className="shell">
      <div className="bg-brand" aria-hidden="true">
        <img className="bg-brand-mark" src={hubMark} alt="" />
      </div>
      <TitleBar />
      <div
        className={`app ${selected ? "with-panel" : ""} ${bigPicture ? "big-picture" : ""} density-${density}`}
      >
        <div className="main-col">
          <header className="topbar">
            <div className="brand-block">
              <p className="brand">The Hub</p>
              <p className="tagline">
                Steam · Epic · Ubisoft · GOG · Xbox · Minecraft
              </p>
            </div>
            <div className="toolbar">
              <input
                className="search"
                type="search"
                placeholder="Search games, tags, Steam cats…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="filter"
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value as StoreFilter)}
              >
                <option value="all">All stores</option>
                <option value="steam">Steam</option>
                <option value="epic">Epic</option>
                <option value="ubisoft">Ubisoft</option>
                <option value="gog">GOG</option>
                <option value="xbox">Xbox</option>
                <option value="minecraft">Minecraft</option>
                <option value="other">Custom</option>
              </select>
              <select
                className="filter"
                value={viewFilter}
                onChange={(e) => setViewFilter(e.target.value as ViewFilter)}
              >
                <option value="all">All games</option>
                <option value="favorites">Favorites</option>
                <option value="recent">Recent</option>
                <option value="hidden">Hidden</option>
                {(prefs?.collections ?? []).map((c) => (
                  <option key={c.id} value={`collection:${c.id}`}>
                    ★ {c.name}
                  </option>
                ))}
              </select>
              <select
                className="filter"
                value={sortBy}
                onChange={(e) =>
                  void patchSettings({ sortBy: e.target.value as SortBy })
                }
                title="Sort"
              >
                <option value="name">Sort: Name</option>
                <option value="recent">Sort: Recent</option>
                <option value="playtime">Sort: Playtime</option>
                <option value="store">Sort: Store</option>
              </select>
              <select
                className="filter"
                value={density}
                onChange={(e) =>
                  void patchSettings({
                    gridDensity: e.target.value as GridDensity,
                  })
                }
                title="Grid density"
              >
                <option value="compact">Grid: Compact</option>
                <option value="comfortable">Grid: Comfortable</option>
                <option value="big">Grid: Big</option>
              </select>
              <button className="btn" type="button" onClick={() => void refresh()}>
                Refresh
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setBigPicture((v) => !v)}
              >
                {bigPicture ? "Exit Big Picture" : "Big Picture"}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() =>
                  void (async () => {
                    const res = await window.hub.addCustomGame();
                    setStatus(res.ok ? res.message ?? "Added." : res.error);
                    if (res.ok) await refresh();
                  })()
                }
              >
                Add game
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
              >
                Settings
              </button>
            </div>
          </header>

          {settingsOpen ? (
            <section className="settings-bar">
              <div className="settings-group">
                <span className="settings-label">Accent</span>
                <div className="accent-row">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`accent-swatch ${accent === a.color ? "active" : ""}`}
                      style={{ background: a.color }}
                      title={a.label}
                      onClick={() => void patchSettings({ accentColor: a.color })}
                    />
                  ))}
                  <input
                    type="color"
                    className="accent-picker"
                    value={accent}
                    onChange={(e) =>
                      void patchSettings({ accentColor: e.target.value })
                    }
                    title="Custom accent"
                  />
                </div>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={prefs?.closeToTray !== false}
                  onChange={(e) =>
                    void patchSettings({ closeToTray: e.target.checked })
                  }
                />
                Close to system tray
              </label>
              <button
                className="btn"
                type="button"
                onClick={() =>
                  void (async () => {
                    const next = await window.hub.importSteamCategories();
                    setPrefs(next);
                    setStatus(
                      `Imported Steam categories into ${next.collections.length} collection(s).`,
                    );
                    await refresh();
                  })()
                }
              >
                Import Steam categories
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() =>
                  void window.hub.checkUpdates().then(setUpdateStatus)
                }
              >
                Check for updates
              </button>
              <div className="settings-group grow">
                <span className="settings-label">New collection</span>
                <div className="row">
                  <input
                    className="search"
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    placeholder="Collection name"
                  />
                  <button
                    className="btn primary"
                    type="button"
                    disabled={!collectionName.trim()}
                    onClick={() =>
                      void (async () => {
                        const next = await window.hub.createCollection(
                          collectionName.trim(),
                        );
                        setPrefs(next);
                        setCollectionName("");
                        setStatus("Collection created.");
                      })()
                    }
                  >
                    Create
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="meta">
            <span>
              {loading
                ? "Scanning libraries…"
                : `${filtered.length} game${filtered.length === 1 ? "" : "s"}`}
            </span>
            {steamPath ? <span className="path">Steam</span> : null}
            {epicPath ? <span className="path">Epic</span> : null}
            {ubisoftPath ? <span className="path">Ubisoft</span> : null}
            {gogPath ? <span className="path">GOG</span> : null}
            {xboxPath ? <span className="path">Xbox</span> : null}
            {minecraftPath ? <span className="path">Minecraft</span> : null}
            {bigPicture ? (
              <span className="status">
                Big Picture · arrows / WASD · Enter launch · Esc exit · gamepad OK
              </span>
            ) : null}
            {updateStatus ? (
              <span className="status update-status">{updateStatus.message}</span>
            ) : null}
            {status ? <span className="status">{status}</span> : null}
            {updateStatus?.available ? (
              <button
                className="btn primary"
                type="button"
                onClick={() => void window.hub.installUpdate()}
              >
                Restart to update
              </button>
            ) : null}
          </section>

          {errors.length > 0 ? (
            <div className="banner">
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          ) : null}

          {!loading && games.length === 0 ? (
            <div className="empty">
              <h1>No games found</h1>
              <p>Install games or use Add game, then hit Refresh.</p>
            </div>
          ) : (
            <div className="grid">
              {filtered.map((game, index) => {
                const isFav = prefs?.favorites.includes(game.id);
                const play = formatPlaytime(game.playtimeMinutes);
                const tags = prefs?.tags[game.id] ?? [];
                const cats = game.steamCategories ?? [];
                const focused = bigPicture && index === focusIndex;
                return (
                  <article
                    key={game.id}
                    ref={(el) => {
                      cardRefs.current[index] = el;
                    }}
                    className={`card ${selected?.id === game.id ? "selected" : ""} ${isFav ? "favorited" : ""} ${focused ? "focused" : ""}`}
                  >
                    <button
                      type="button"
                      className="card-hit"
                      onClick={() => {
                        setFocusIndex(index);
                        void selectGame(game);
                      }}
                      onDoubleClick={() => void launch(game)}
                    >
                      <Cover game={game} />
                      {isFav ? <span className="badge fav">★</span> : null}
                    </button>
                    <div className="card-body">
                      <h2>{game.name}</h2>
                      <p className="store">
                        {storeLabel(game.store)}
                        {play ? ` · ${play}` : ""}
                      </p>
                      {tags.length > 0 || cats.length > 0 ? (
                        <p className="tag-row">
                          {[...tags, ...cats].slice(0, 4).join(" · ")}
                        </p>
                      ) : null}
                      <div className="card-actions">
                        <button
                          className="btn primary"
                          type="button"
                          disabled={!game.launchId}
                          onClick={() => void launch(game)}
                        >
                          Launch
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => void selectGame(game)}
                        >
                          Tools
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <aside className="side-panel">
            <div className="side-head">
              <div>
                <p className="side-kicker">{storeLabel(selected.store)}</p>
                <h2>{selected.name}</h2>
              </div>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setSelected(null);
                  setExtras(null);
                }}
              >
                Close
              </button>
            </div>

            <button
              className="btn primary wide"
              type="button"
              disabled={!selected.launchId}
              onClick={() => void launch(selected)}
            >
              Launch game
            </button>

            {extrasLoading || !extras ? (
              <p className="muted">Loading tools…</p>
            ) : (
              <>
                <section className="side-section">
                  <h3>Library</h3>
                  <div className="row">
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void runAction(async () => {
                          await window.hub.toggleFavorite(selected.id);
                          return { ok: true, message: "Favorite updated." };
                        })
                      }
                    >
                      {extras.favorite ? "Unfavorite" : "Favorite"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void runAction(async () => {
                          await window.hub.toggleHidden(selected.id);
                          return { ok: true, message: "Visibility updated." };
                        })
                      }
                    >
                      {extras.hidden ? "Unhide" : "Hide"}
                    </button>
                    {selected.store === "other" ? (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() =>
                          void runAction(async () => {
                            await window.hub.removeCustomGame(selected.id);
                            setSelected(null);
                            await refresh();
                            return { ok: true, message: "Custom game removed." };
                          })
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {formatPlaytime(selected.playtimeMinutes) ? (
                    <p className="muted small">
                      Playtime: {formatPlaytime(selected.playtimeMinutes)}
                    </p>
                  ) : null}
                  {(selected.steamCategories?.length ?? 0) > 0 ? (
                    <p className="muted small">
                      Steam: {selected.steamCategories!.join(", ")}
                    </p>
                  ) : null}
                  <label className="field">
                    <span>Tags (comma separated)</span>
                    <input
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      placeholder="co-op, finished, story"
                    />
                  </label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void runAction(async () => {
                        await window.hub.setTags(
                          selected.id,
                          tagDraft.split(",").map((t) => t.trim()),
                        );
                        return { ok: true, message: "Tags saved." };
                      })
                    }
                  >
                    Save tags
                  </button>
                </section>

                <section className="side-section">
                  <h3>Collections</h3>
                  {(prefs?.collections ?? []).length === 0 ? (
                    <p className="muted small">
                      Create a collection in Settings, or import Steam
                      categories.
                    </p>
                  ) : (
                    <div className="collection-checks">
                      {prefs!.collections.map((c) => {
                        const on = extras.collectionIds.includes(c.id);
                        return (
                          <label key={c.id} className="check-row">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                void runAction(async () => {
                                  await window.hub.toggleGameInCollection(
                                    c.id,
                                    selected.id,
                                  );
                                  return {
                                    ok: true,
                                    message: on
                                      ? `Removed from ${c.name}`
                                      : `Added to ${c.name}`,
                                  };
                                })
                              }
                            />
                            {c.name}
                            <button
                              type="button"
                              className="linkish"
                              onClick={() =>
                                void (async () => {
                                  const next = await window.hub.deleteCollection(
                                    c.id,
                                  );
                                  setPrefs(next);
                                  if (viewFilter === `collection:${c.id}`) {
                                    setViewFilter("all");
                                  }
                                  await loadExtras(selected);
                                })()
                              }
                            >
                              Delete
                            </button>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="side-section">
                  <h3>Launch options</h3>
                  <label className="field">
                    <span>Arguments</span>
                    <input
                      value={launchDraft.args ?? ""}
                      onChange={(e) =>
                        setLaunchDraft((d) => ({ ...d, args: e.target.value }))
                      }
                      placeholder="-windowed -novid"
                    />
                  </label>
                  <label className="field">
                    <span>Working directory (optional)</span>
                    <input
                      value={launchDraft.cwd ?? ""}
                      onChange={(e) =>
                        setLaunchDraft((d) => ({ ...d, cwd: e.target.value }))
                      }
                      placeholder="Leave blank for default"
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={!!launchDraft.runAsAdmin}
                      onChange={(e) =>
                        setLaunchDraft((d) => ({
                          ...d,
                          runAsAdmin: e.target.checked,
                        }))
                      }
                    />
                    Run as administrator (custom / Xbox exe)
                  </label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void runAction(async () => {
                        await window.hub.setLaunchOptions(
                          selected.id,
                          launchDraft,
                        );
                        return { ok: true, message: "Launch options saved." };
                      })
                    }
                  >
                    Save launch options
                  </button>
                </section>

                <section className="side-section">
                  <h3>Save folder</h3>
                  <p className="muted small">
                    {extras.savePath
                      ? extras.savePath
                      : "Not linked yet — pick a folder or use a guess."}
                  </p>
                  <div className="row">
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void runAction(() => window.hub.pickSavePath(selected.id))
                      }
                    >
                      Pick folder
                    </button>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() =>
                        void runAction(() => window.hub.createBackup(selected.id))
                      }
                    >
                      Backup now
                    </button>
                  </div>
                  {extras.guessedSavePaths.length > 0 ? (
                    <div className="guess-list">
                      <p className="small">Guessed locations:</p>
                      {extras.guessedSavePaths.map((path) => (
                        <button
                          key={path}
                          type="button"
                          className="guess"
                          onClick={() =>
                            void runAction(() =>
                              window.hub.setSavePath(selected.id, path),
                            )
                          }
                        >
                          Use: {path}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="side-section">
                  <h3>Backups</h3>
                  {extras.backups.length === 0 ? (
                    <p className="muted small">No backups yet.</p>
                  ) : (
                    <ul className="backup-list">
                      {extras.backups.map((b) => (
                        <li key={b.id}>
                          <span>{b.id}</span>
                          <div className="row">
                            <button
                              className="btn"
                              type="button"
                              onClick={() =>
                                void runAction(() =>
                                  window.hub.restoreBackup(selected.id, b.id),
                                )
                              }
                            >
                              Restore
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() =>
                                void runAction(() =>
                                  window.hub.deleteBackup(selected.id, b.id),
                                )
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="side-section">
                  <h3>Notes</h3>
                  <textarea
                    className="notes"
                    rows={6}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Settings, loadouts, reminders…"
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void runAction(() =>
                        window.hub.saveNotes(selected.id, notes),
                      )
                    }
                  >
                    Save notes
                  </button>
                </section>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
