import { useCallback, useEffect, useMemo, useState } from "react";
import type { HubGame } from "../../shared/types";

function Cover({ game }: { game: HubGame }) {
  const [failed, setFailed] = useState(false);
  if (!game.coverUrl || failed) {
    return <div className="cover fallback">{game.name.slice(0, 1)}</div>;
  }
  return (
    <img
      className="cover"
      src={game.coverUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function App() {
  const [games, setGames] = useState<HubGame[]>([]);
  const [steamPath, setSteamPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await window.hub.scanLibrary();
      setGames(result.games);
      setSteamPath(result.steamPath);
      setErrors(result.errors);
    } catch (err) {
      setErrors([String(err)]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.name.toLowerCase().includes(q));
  }, [games, query]);

  async function launch(game: HubGame) {
    if (!game.appId) return;
    setStatus(`Launching ${game.name}…`);
    const result = await window.hub.launchGame(game.appId);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setStatus(`Started ${game.name} via Steam`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">The Hub</p>
          <p className="tagline">All your games. One library.</p>
        </div>
        <div className="toolbar">
          <input
            className="search"
            type="search"
            placeholder="Search games…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => void window.hub.openSteam()}
          >
            Open Steam
          </button>
        </div>
      </header>

      <section className="meta">
        <span>
          {loading
            ? "Scanning Steam…"
            : `${filtered.length} game${filtered.length === 1 ? "" : "s"}`}
        </span>
        {steamPath ? <span className="path">Steam: {steamPath}</span> : null}
        {status ? <span className="status">{status}</span> : null}
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
          <h1>No Steam games found</h1>
          <p>
            Install Steam and at least one game, then hit Refresh. Epic and other
            stores come next.
          </p>
        </div>
      ) : (
        <div className="grid">
          {filtered.map((game) => (
            <article key={game.id} className="card">
              <Cover game={game} />
              <div className="card-body">
                <h2>{game.name}</h2>
                <p className="store">Steam</p>
                <button
                  className="btn primary"
                  type="button"
                  disabled={!game.appId}
                  onClick={() => void launch(game)}
                >
                  Launch
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
