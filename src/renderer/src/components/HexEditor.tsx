import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import type {
  ActionResult,
  SaveJsonField,
  SaveValueHit,
  SaveValueKind,
} from "../../../shared/types";

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 22;
const OVERSCAN = 8;

const KIND_OPTIONS: Array<{ id: SaveValueKind; label: string }> = [
  { id: "i32le", label: "Int32" },
  { id: "u32le", label: "UInt32" },
  { id: "i64le", label: "Int64" },
  { id: "f32le", label: "Float" },
  { id: "text", label: "Text" },
];

type Props = {
  gameId: string;
  relativePath: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  runAction: (action: () => Promise<ActionResult>) => Promise<void>;
};

function hitKey(hit: SaveValueHit): string {
  return `${hit.offset}:${hit.kind}`;
}

function toHex(n: number, width = 2): string {
  return n.toString(16).toUpperCase().padStart(width, "0");
}

function asciiChar(byte: number): string {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function kindLength(kind: SaveValueKind, value: number): number {
  switch (kind) {
    case "i64le":
      return 8;
    case "text":
      return String(value).length;
    default:
      return 4;
  }
}

export function HexEditor({
  gameId,
  relativePath,
  onClose,
  onSaved,
  runAction,
}: Props) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [original, setOriginal] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [pendingHigh, setPendingHigh] = useState<number | null>(null);
  const [gotoDraft, setGotoDraft] = useState("0");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [searchDraft, setSearchDraft] = useState("");
  const [replaceDraft, setReplaceDraft] = useState("");
  const [kinds, setKinds] = useState<SaveValueKind[]>([
    "i32le",
    "u32le",
    "i64le",
    "f32le",
    "text",
  ]);
  const [hits, setHits] = useState<SaveValueHit[]>([]);
  const [selectedHits, setSelectedHits] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [jsonFields, setJsonFields] = useState<SaveJsonField[]>([]);
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [showJson, setShowJson] = useState(false);
  const [busy, setBusy] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  const dirtyCount = useMemo(() => {
    if (!bytes || !original || bytes.length !== original.length) {
      return bytes && original ? Math.abs(bytes.length - original.length) : 0;
    }
    let n = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] !== original[i]) n += 1;
    }
    return n;
  }, [bytes, original]);

  const highlight = useMemo(() => {
    const map = new Map<number, "hit" | "sel">();
    for (const hit of hits) {
      if (!selectedHits.has(hitKey(hit))) continue;
      const len = hit.byteLength || kindLength(hit.kind, hit.value);
      for (let i = 0; i < len; i += 1) map.set(hit.offset + i, "sel");
    }
    for (const hit of hits) {
      const len = hit.byteLength || kindLength(hit.kind, hit.value);
      for (let i = 0; i < len; i += 1) {
        if (!map.has(hit.offset + i)) map.set(hit.offset + i, "hit");
      }
    }
    return map;
  }, [hits, selectedHits]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const [bytesRes, inspectRes] = await Promise.all([
        window.hub.readSaveBytes(gameId, relativePath),
        window.hub.inspectSaveFile(gameId, relativePath),
      ]);
      if (!bytesRes.ok || !bytesRes.base64) {
        setError(bytesRes.ok ? "Could not read file." : bytesRes.error);
        setBytes(null);
        setOriginal(null);
        return;
      }
      const next = base64ToBytes(bytesRes.base64);
      setBytes(next);
      setOriginal(new Uint8Array(next));
      setCursor(0);
      setPendingHigh(null);
      setGotoDraft("0");
      setHits([]);
      setSelectedHits(new Set());

      if (inspectRes.ok && inspectRes.kind === "json" && inspectRes.jsonFields) {
        setJsonFields(inspectRes.jsonFields);
        const drafts: Record<string, string> = {};
        for (const field of inspectRes.jsonFields) {
          drafts[field.path] = String(field.value);
        }
        setJsonDrafts(drafts);
        setShowJson(inspectRes.jsonFields.length > 0);
      } else {
        setJsonFields([]);
        setJsonDrafts({});
        setShowJson(false);
      }
    } finally {
      setLoading(false);
      queueMicrotask(() => focusRef.current?.focus());
    }
  }, [gameId, relativePath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight || 480);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, bytes]);

  const rowCount = bytes ? Math.max(1, Math.ceil(bytes.length / BYTES_PER_ROW)) : 0;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRows = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endRow = Math.min(rowCount, startRow + visibleRows);

  function scrollToOffset(offset: number) {
    const el = scrollerRef.current;
    if (!el || !bytes) return;
    const clamped = Math.max(0, Math.min(bytes.length - 1, offset));
    const row = Math.floor(clamped / BYTES_PER_ROW);
    const top = row * ROW_HEIGHT;
    const viewBottom = el.scrollTop + el.clientHeight;
    if (top < el.scrollTop || top + ROW_HEIGHT > viewBottom) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  }

  function selectOffset(offset: number) {
    if (!bytes) return;
    const clamped = Math.max(0, Math.min(bytes.length - 1, offset));
    setCursor(clamped);
    setPendingHigh(null);
    setGotoDraft(toHex(clamped, 8));
    scrollToOffset(clamped);
  }

  function writeByte(offset: number, value: number) {
    setBytes((prev) => {
      if (!prev || offset < 0 || offset >= prev.length) return prev;
      if (prev[offset] === value) return prev;
      const next = new Uint8Array(prev);
      next[offset] = value;
      return next;
    });
  }

  function onHexKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!bytes) return;
    const key = e.key;

    if (key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "s") {
      e.preventDefault();
      void saveFile();
      return;
    }

    if (key === "ArrowLeft") {
      e.preventDefault();
      selectOffset(cursor - 1);
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      selectOffset(cursor + 1);
      return;
    }
    if (key === "ArrowUp") {
      e.preventDefault();
      selectOffset(cursor - BYTES_PER_ROW);
      return;
    }
    if (key === "ArrowDown") {
      e.preventDefault();
      selectOffset(cursor + BYTES_PER_ROW);
      return;
    }
    if (key === "Home") {
      e.preventDefault();
      selectOffset(e.ctrlKey ? 0 : cursor - (cursor % BYTES_PER_ROW));
      return;
    }
    if (key === "End") {
      e.preventDefault();
      if (e.ctrlKey) selectOffset(bytes.length - 1);
      else {
        const rowStart = cursor - (cursor % BYTES_PER_ROW);
        selectOffset(Math.min(bytes.length - 1, rowStart + BYTES_PER_ROW - 1));
      }
      return;
    }
    if (key === "Backspace" || key === "Delete") {
      e.preventDefault();
      setPendingHigh(null);
      return;
    }

    const hex = /^[0-9a-fA-F]$/.test(key) ? Number.parseInt(key, 16) : null;
    if (hex == null) return;
    e.preventDefault();
    if (pendingHigh == null) {
      setPendingHigh(hex);
      writeByte(cursor, (bytes[cursor]! & 0x0f) | (hex << 4));
    } else {
      writeByte(cursor, (pendingHigh << 4) | hex);
      setPendingHigh(null);
      selectOffset(Math.min(bytes.length - 1, cursor + 1));
    }
  }

  async function saveFile() {
    if (!bytes) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await window.hub.writeSaveBytes(
        gameId,
        relativePath,
        bytesToBase64(bytes),
      );
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      setOriginal(new Uint8Array(bytes));
      setStatus(res.message ?? "Saved.");
      onSaved(res.message ?? "Saved.");
      await runAction(async () => res);
    } finally {
      setBusy(false);
    }
  }

  function runScan() {
    if (!bytes) return;
    const value = Number(searchDraft);
    if (!Number.isFinite(value)) {
      setStatus("Enter the current in-game number to search for.");
      return;
    }
    if (kinds.length === 0) {
      setStatus("Pick at least one value encoding.");
      return;
    }
    const localHits = scanLocal(bytes, value, kinds);
    setHits(localHits);
    setSelectedHits(new Set(localHits.map(hitKey)));
    setStatus(
      localHits.length
        ? `Found ${localHits.length} match${localHits.length === 1 ? "" : "es"}.`
        : "No matching values in the open buffer.",
    );
    if (localHits[0]) selectOffset(localHits[0].offset);
    if (!replaceDraft) setReplaceDraft(String(value));
  }

  function applyLocalReplace() {
    if (!bytes) return;
    const newValue = Number(replaceDraft);
    if (!Number.isFinite(newValue)) {
      setStatus("Enter a valid new value.");
      return;
    }
    const chosen = hits.filter((h) => selectedHits.has(hitKey(h)));
    if (chosen.length === 0) {
      setStatus("Select at least one match to replace.");
      return;
    }

    const ordered = [...chosen].sort((a, b) => b.offset - a.offset);
    let next = new Uint8Array(bytes);
    let replaced = 0;

    for (const hit of ordered) {
      const encoded = encodeLocal(hit.kind, newValue);
      const oldEncoded = encodeLocal(hit.kind, hit.value);
      if (!encoded || !oldEncoded) {
        setStatus(`Value does not fit encoding ${hit.kind}.`);
        return;
      }
      if (hit.offset + oldEncoded.length > next.length) {
        setStatus("Replacement is outside the file.");
        return;
      }
      for (let i = 0; i < oldEncoded.length; i += 1) {
        if (next[hit.offset + i] !== oldEncoded[i]) {
          setStatus("Buffer changed since search. Find values again.");
          return;
        }
      }
      if (hit.kind === "text") {
        const before = next.subarray(0, hit.offset);
        const after = next.subarray(hit.offset + oldEncoded.length);
        const merged = new Uint8Array(before.length + encoded.length + after.length);
        merged.set(before, 0);
        merged.set(encoded, before.length);
        merged.set(after, before.length + encoded.length);
        next = merged;
      } else {
        next.set(encoded, hit.offset);
      }
      replaced += 1;
    }

    setBytes(next);
    setHits([]);
    setSelectedHits(new Set());
    setStatus(
      `Staged ${replaced} replacement${replaced === 1 ? "" : "s"} — Save to write (backup on save).`,
    );
    if (ordered[ordered.length - 1]) {
      selectOffset(ordered[ordered.length - 1]!.offset);
    }
  }

  async function applyJsonField(path: string) {
    const newValue = Number(jsonDrafts[path]);
    if (!Number.isFinite(newValue)) {
      setStatus(`Enter a valid number for ${path}.`);
      return;
    }
    if (dirtyCount > 0) {
      setStatus("Save or reload before using JSON field edits.");
      return;
    }
    setBusy(true);
    try {
      const res = await window.hub.replaceSaveJsonField(
        gameId,
        relativePath,
        path,
        newValue,
      );
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      setStatus(res.message ?? "Updated.");
      onSaved(res.message ?? "Updated.");
      await runAction(async () => res);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function onScroll(e: UIEvent<HTMLDivElement>) {
    setScrollTop(e.currentTarget.scrollTop);
  }

  const selectionInfo = useMemo(() => {
    if (!bytes || cursor < 0 || cursor >= bytes.length) return null;
    const slice = bytes.subarray(cursor, Math.min(bytes.length, cursor + 8));
    const buf = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
    const parts: string[] = [`@ 0x${toHex(cursor, 8)}`];
    parts.push(`u8=${bytes[cursor]}`);
    if (slice.byteLength >= 4) {
      parts.push(`i32=${buf.getInt32(0, true)}`);
      parts.push(`u32=${buf.getUint32(0, true)}`);
      parts.push(`f32=${buf.getFloat32(0, true).toPrecision(6)}`);
    }
    if (slice.byteLength >= 8) {
      const big = buf.getBigInt64(0, true);
      if (
        big <= BigInt(Number.MAX_SAFE_INTEGER) &&
        big >= BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        parts.push(`i64=${Number(big)}`);
      }
    }
    return parts.join(" · ");
  }, [bytes, cursor]);

  return (
    <div className="modal-backdrop hex-backdrop" role="presentation">
      <div
        className="hex-modal"
        role="dialog"
        aria-labelledby="hex-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="hex-head">
          <div>
            <p className="side-kicker">Hex editor</p>
            <h2 id="hex-title">{relativePath}</h2>
            <p className="muted small">
              Single-player saves only. Type hex digits to edit · arrows move ·
              Ctrl+S saves (backup first).
            </p>
          </div>
          <div className="row">
            <button
              className="btn ghost"
              type="button"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              Reload
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={busy || loading || !bytes || dirtyCount === 0}
              onClick={() => void saveFile()}
            >
              Save{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                if (
                  dirtyCount > 0 &&
                  !window.confirm(
                    "Discard unsaved hex edits? Your changes will be lost.",
                  )
                ) {
                  return;
                }
                onClose();
              }}
            >
              Close
            </button>
          </div>
        </header>

        {loading ? <p className="muted">Loading file…</p> : null}
        {error ? <p className="muted">{error}</p> : null}

        {bytes ? (
          <div className="hex-layout">
            <div className="hex-main">
              <div className="hex-toolbar row">
                <label className="field tight hex-goto">
                  <span>Goto</span>
                  <input
                    value={gotoDraft}
                    onChange={(e) => setGotoDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const raw = gotoDraft.trim().replace(/^0x/i, "");
                        const n = Number.parseInt(raw, 16);
                        if (Number.isFinite(n)) selectOffset(n);
                      }
                    }}
                    spellCheck={false}
                  />
                </label>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const raw = gotoDraft.trim().replace(/^0x/i, "");
                    const n = Number.parseInt(raw, 16);
                    if (Number.isFinite(n)) selectOffset(n);
                  }}
                >
                  Jump
                </button>
                <span className="muted small hex-meta">
                  {bytes.length} bytes
                  {dirtyCount > 0 ? ` · ${dirtyCount} modified` : " · clean"}
                </span>
              </div>

              <div
                className="hex-view"
                ref={focusRef}
                tabIndex={0}
                onKeyDown={onHexKeyDown}
              >
                <div className="hex-col-head">
                  <span className="hex-offset">Offset</span>
                  <span className="hex-bytes">
                    {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                      <span key={i}>{toHex(i)}</span>
                    ))}
                  </span>
                  <span className="hex-ascii">ASCII</span>
                </div>
                <div
                  className="hex-scroller"
                  ref={scrollerRef}
                  onScroll={onScroll}
                >
                  <div
                    className="hex-spacer"
                    style={{ height: rowCount * ROW_HEIGHT }}
                  >
                    <div
                      className="hex-window"
                      style={{ transform: `translateY(${startRow * ROW_HEIGHT}px)` }}
                    >
                      {Array.from({ length: endRow - startRow }, (_, i) => {
                        const row = startRow + i;
                        const rowStart = row * BYTES_PER_ROW;
                        return (
                          <div
                            key={row}
                            className="hex-row"
                            style={{ height: ROW_HEIGHT }}
                          >
                            <span className="hex-offset">
                              {toHex(rowStart, 8)}
                            </span>
                            <span className="hex-bytes">
                              {Array.from({ length: BYTES_PER_ROW }, (_, col) => {
                                const offset = rowStart + col;
                                if (offset >= bytes.length) {
                                  return (
                                    <span key={col} className="hex-byte empty">
                                      {"  "}
                                    </span>
                                  );
                                }
                                const mark = highlight.get(offset);
                                const dirty =
                                  original != null &&
                                  original[offset] !== bytes[offset];
                                const classes = [
                                  "hex-byte",
                                  offset === cursor ? "cursor" : "",
                                  pendingHigh != null && offset === cursor
                                    ? "nibble"
                                    : "",
                                  mark === "sel" ? "hit-sel" : "",
                                  mark === "hit" ? "hit" : "",
                                  dirty ? "dirty" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ");
                                return (
                                  <button
                                    key={col}
                                    type="button"
                                    className={classes}
                                    onClick={() => selectOffset(offset)}
                                  >
                                    {toHex(bytes[offset]!)}
                                  </button>
                                );
                              })}
                            </span>
                            <span className="hex-ascii">
                              {Array.from({ length: BYTES_PER_ROW }, (_, col) => {
                                const offset = rowStart + col;
                                if (offset >= bytes.length) {
                                  return <span key={col}> </span>;
                                }
                                const mark = highlight.get(offset);
                                return (
                                  <button
                                    key={col}
                                    type="button"
                                    className={[
                                      "ascii-byte",
                                      offset === cursor ? "cursor" : "",
                                      mark === "sel" ? "hit-sel" : "",
                                      mark === "hit" ? "hit" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    onClick={() => selectOffset(offset)}
                                  >
                                    {asciiChar(bytes[offset]!)}
                                  </button>
                                );
                              })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              {selectionInfo ? (
                <p className="muted small hex-selection">{selectionInfo}</p>
              ) : null}
            </div>

            <aside className="hex-tools">
              <h3>Find values</h3>
              <p className="muted small">
                Search for money/stats, jump to matches, then edit bytes or
                replace.
              </p>
              <label className="field tight">
                <span>Current value</span>
                <input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 1250"
                />
              </label>
              <div className="kind-toggles">
                {KIND_OPTIONS.map((opt) => (
                  <label key={opt.id} className="kind-toggle">
                    <input
                      type="checkbox"
                      checked={kinds.includes(opt.id)}
                      onChange={() =>
                        setKinds((prev) =>
                          prev.includes(opt.id)
                            ? prev.filter((k) => k !== opt.id)
                            : [...prev, opt.id],
                        )
                      }
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={runScan}
              >
                Find values
              </button>

              {hits.length > 0 ? (
                <>
                  <ul className="save-hit-list hex-hit-list">
                    {hits.map((hit) => {
                      const key = hitKey(hit);
                      return (
                        <li key={key}>
                          <label className="save-hit">
                            <input
                              type="checkbox"
                              checked={selectedHits.has(key)}
                              onChange={() =>
                                setSelectedHits((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                            />
                            <button
                              type="button"
                              className="hit-jump"
                              onClick={() => selectOffset(hit.offset)}
                            >
                              {hit.label} = {hit.value}
                            </button>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <label className="field tight">
                    <span>New value</span>
                    <input
                      value={replaceDraft}
                      onChange={(e) => setReplaceDraft(e.target.value)}
                      inputMode="decimal"
                      placeholder="e.g. 999999"
                    />
                  </label>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={busy || selectedHits.size === 0}
                    onClick={applyLocalReplace}
                  >
                    Stage replace
                  </button>
                </>
              ) : null}

              {jsonFields.length > 0 ? (
                <div className="hex-json">
                  <button
                    type="button"
                    className="btn ghost wide"
                    onClick={() => setShowJson((v) => !v)}
                  >
                    {showJson ? "Hide" : "Show"} JSON fields
                  </button>
                  {showJson ? (
                    <ul className="json-field-list">
                      {jsonFields.map((field) => (
                        <li key={field.path}>
                          <label className="field tight">
                            <span>{field.path}</span>
                            <span className="json-field-row">
                              <input
                                value={jsonDrafts[field.path] ?? ""}
                                onChange={(e) =>
                                  setJsonDrafts((prev) => ({
                                    ...prev,
                                    [field.path]: e.target.value,
                                  }))
                                }
                                inputMode="decimal"
                              />
                              <button
                                className="btn primary"
                                type="button"
                                disabled={busy || dirtyCount > 0}
                                onClick={() => void applyJsonField(field.path)}
                              >
                                Set
                              </button>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </aside>
          </div>
        ) : null}

        {status ? <p className="muted small hex-status">{status}</p> : null}
      </div>
    </div>
  );
}

function encodeLocal(kind: SaveValueKind, value: number): Uint8Array | null {
  if (!Number.isFinite(value)) return null;
  try {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    switch (kind) {
      case "i32le": {
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
          return null;
        view.setInt32(0, value, true);
        return new Uint8Array(buf, 0, 4);
      }
      case "u32le": {
        if (!Number.isInteger(value) || value < 0 || value > 4294967295)
          return null;
        view.setUint32(0, value, true);
        return new Uint8Array(buf, 0, 4);
      }
      case "i64le": {
        if (!Number.isInteger(value) || !Number.isSafeInteger(value)) return null;
        view.setBigInt64(0, BigInt(value), true);
        return new Uint8Array(buf, 0, 8);
      }
      case "f32le": {
        view.setFloat32(0, value, true);
        if (Math.abs(view.getFloat32(0, true) - value) > Math.max(1, Math.abs(value)) * 1e-6) {
          return null;
        }
        return new Uint8Array(buf, 0, 4);
      }
      case "text":
        return new TextEncoder().encode(String(value));
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number[] {
  const hits: number[] = [];
  if (!needle.length || haystack.length < needle.length) return hits;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    hits.push(i);
    if (hits.length >= 80) break;
  }
  return hits;
}

function isStandaloneText(
  buf: Uint8Array,
  offset: number,
  length: number,
): boolean {
  const before = offset > 0 ? buf[offset - 1]! : null;
  const after = offset + length < buf.length ? buf[offset + length]! : null;
  const digit = (b: number) => b >= 48 && b <= 57;
  if (before != null && (digit(before) || before === 46)) return false;
  if (after != null && (digit(after) || after === 46)) return false;
  return true;
}

function scanLocal(
  bytes: Uint8Array,
  value: number,
  kinds: SaveValueKind[],
): SaveValueHit[] {
  const hits: SaveValueHit[] = [];
  for (const kind of kinds) {
    const needle = encodeLocal(kind, value);
    if (!needle) continue;
    for (const offset of findBytes(bytes, needle)) {
      if (kind === "text" && !isStandaloneText(bytes, offset, needle.length)) {
        continue;
      }
      hits.push({
        offset,
        kind,
        value,
        byteLength: needle.length,
        label: `0x${toHex(offset, 8)} · ${kind}`,
      });
      if (hits.length >= 80) return hits;
    }
  }
  return hits.sort((a, b) => a.offset - b.offset || a.kind.localeCompare(b.kind));
}
