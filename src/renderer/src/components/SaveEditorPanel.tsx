import { useEffect, useMemo, useState } from "react";
import type {
  ActionResult,
  SaveFileEntry,
  SaveJsonField,
  SaveValueHit,
  SaveValueKind,
} from "../../../shared/types";

type Props = {
  gameId: string;
  savePath: string | null;
  isPremium: boolean;
  requirePremium: (feature: string) => boolean;
  runAction: (action: () => Promise<ActionResult>) => Promise<void>;
};

type InspectState = {
  kind: "json" | "text" | "binary";
  jsonFields?: SaveJsonField[];
  textPreview?: string;
  fileSize?: number;
  truncatedJson?: boolean;
};

const KIND_OPTIONS: Array<{ id: SaveValueKind; label: string }> = [
  { id: "i32le", label: "Int32" },
  { id: "u32le", label: "UInt32" },
  { id: "i64le", label: "Int64" },
  { id: "f32le", label: "Float" },
  { id: "text", label: "Text" },
];

function hitKey(hit: SaveValueHit): string {
  return `${hit.offset}:${hit.kind}`;
}

export function SaveEditorPanel({
  gameId,
  savePath,
  isPremium,
  requirePremium,
  runAction,
}: Props) {
  const [files, setFiles] = useState<SaveFileEntry[]>([]);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectState | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
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
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFiles([]);
    setFilesTruncated(false);
    setFileFilter("");
    setSelectedFile(null);
    setInspect(null);
    setSearchDraft("");
    setReplaceDraft("");
    setHits([]);
    setSelectedHits(new Set());
    setScanMessage(null);
    setJsonDrafts({});
  }, [gameId, savePath]);

  const filteredFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.relativePath.toLowerCase().includes(q));
  }, [files, fileFilter]);

  async function loadFiles() {
    if (!requirePremium("Save value editor")) return;
    if (!savePath) {
      setScanMessage("Link a save folder first.");
      return;
    }
    setFilesLoading(true);
    setScanMessage(null);
    try {
      const res = await window.hub.listSaveFiles(gameId);
      if (!res.ok) {
        setScanMessage(res.error);
        setFiles([]);
        return;
      }
      setFiles(res.files ?? []);
      setFilesTruncated(!!res.truncated);
      if ((res.files?.length ?? 0) === 0) {
        setScanMessage("No files found in the linked save folder.");
      }
    } finally {
      setFilesLoading(false);
    }
  }

  async function openFile(relativePath: string) {
    if (!requirePremium("Save value editor")) return;
    setSelectedFile(relativePath);
    setInspect(null);
    setHits([]);
    setSelectedHits(new Set());
    setScanMessage(null);
    setJsonDrafts({});
    setInspectLoading(true);
    try {
      const res = await window.hub.inspectSaveFile(gameId, relativePath);
      if (!res.ok || !res.kind) {
        setScanMessage(res.ok ? "Could not inspect file." : res.error);
        return;
      }
      const next: InspectState = {
        kind: res.kind,
        jsonFields: res.jsonFields,
        textPreview: res.textPreview,
        fileSize: res.fileSize,
        truncatedJson: res.truncatedJson,
      };
      setInspect(next);
      if (res.jsonFields) {
        const drafts: Record<string, string> = {};
        for (const field of res.jsonFields) {
          drafts[field.path] = String(field.value);
        }
        setJsonDrafts(drafts);
      }
    } finally {
      setInspectLoading(false);
    }
  }

  async function runScan() {
    if (!requirePremium("Save value editor")) return;
    if (!selectedFile) return;
    const value = Number(searchDraft);
    if (!Number.isFinite(value)) {
      setScanMessage("Enter the current in-game number to search for.");
      return;
    }
    if (kinds.length === 0) {
      setScanMessage("Pick at least one value encoding.");
      return;
    }
    setBusy(true);
    setScanMessage(null);
    try {
      const res = await window.hub.scanSaveValues(
        gameId,
        selectedFile,
        value,
        kinds,
      );
      if (!res.ok) {
        setHits([]);
        setSelectedHits(new Set());
        setScanMessage(res.error);
        return;
      }
      const nextHits = res.hits ?? [];
      setHits(nextHits);
      setSelectedHits(new Set(nextHits.map(hitKey)));
      setScanMessage(
        res.message ??
          (nextHits.length
            ? `Found ${nextHits.length} match${nextHits.length === 1 ? "" : "es"}.`
            : "No matches."),
      );
      if (!replaceDraft && Number.isFinite(value)) {
        setReplaceDraft(String(value));
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyBinaryReplace() {
    if (!requirePremium("Save value editor")) return;
    if (!selectedFile) return;
    const newValue = Number(replaceDraft);
    if (!Number.isFinite(newValue)) {
      setScanMessage("Enter a valid new value.");
      return;
    }
    const chosen = hits.filter((h) => selectedHits.has(hitKey(h)));
    if (chosen.length === 0) {
      setScanMessage("Select at least one match to replace.");
      return;
    }
    setBusy(true);
    try {
      await runAction(() =>
        window.hub.replaceSaveValues(
          gameId,
          selectedFile,
          chosen.map((h) => ({
            offset: h.offset,
            kind: h.kind,
            oldValue: h.value,
            newValue,
          })),
        ),
      );
      await openFile(selectedFile);
      setHits([]);
      setSelectedHits(new Set());
      setScanMessage("Values updated. Re-search if you want to verify.");
    } finally {
      setBusy(false);
    }
  }

  async function applyJsonField(path: string) {
    if (!requirePremium("Save value editor")) return;
    if (!selectedFile) return;
    const newValue = Number(jsonDrafts[path]);
    if (!Number.isFinite(newValue)) {
      setScanMessage(`Enter a valid number for ${path}.`);
      return;
    }
    setBusy(true);
    try {
      await runAction(() =>
        window.hub.replaceSaveJsonField(gameId, selectedFile, path, newValue),
      );
      await openFile(selectedFile);
    } finally {
      setBusy(false);
    }
  }

  function toggleKind(kind: SaveValueKind) {
    setKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  function toggleHit(hit: SaveValueHit) {
    const key = hitKey(hit);
    setSelectedHits((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="side-section">
      <h3>
        Save editor{" "}
        {!isPremium ? <span className="premium-lock">Premium</span> : null}
      </h3>
      <p className="muted small">
        For single-player saves only. Close the game first. Hub creates a backup
        before every write.
      </p>

      {!savePath ? (
        <p className="muted small">Link a save folder above to browse files.</p>
      ) : (
        <>
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={filesLoading || busy}
              onClick={() => void loadFiles()}
            >
              {filesLoading ? "Loading…" : "Browse save files"}
            </button>
          </div>

          {files.length > 0 ? (
            <>
              <label className="field tight">
                <span>Filter files</span>
                <input
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  placeholder="save, player, inventory…"
                />
              </label>
              {filesTruncated ? (
                <p className="muted small">
                  Showing the first {files.length} files.
                </p>
              ) : null}
              <ul className="save-file-list">
                {filteredFiles.map((file) => (
                  <li key={file.relativePath}>
                    <button
                      type="button"
                      className={
                        selectedFile === file.relativePath
                          ? "save-file active"
                          : "save-file"
                      }
                      onClick={() => void openFile(file.relativePath)}
                    >
                      <span className="save-file-name">{file.relativePath}</span>
                      <span className="muted small">{file.sizeLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {inspectLoading ? (
            <p className="muted small">Reading file…</p>
          ) : null}

          {selectedFile && inspect ? (
            <div className="save-editor-body">
              <p className="small">
                <strong>{selectedFile}</strong>
                {inspect.fileSize != null
                  ? ` · ${inspect.kind} · ${inspect.fileSize} bytes`
                  : ` · ${inspect.kind}`}
              </p>

              {inspect.kind === "json" && inspect.jsonFields ? (
                <>
                  <p className="muted small">
                    JSON numbers found
                    {inspect.truncatedJson ? " (truncated)" : ""}. Edit money,
                    resources, and similar fields directly.
                  </p>
                  {inspect.jsonFields.length === 0 ? (
                    <p className="muted small">No numeric fields in this JSON.</p>
                  ) : (
                    <ul className="json-field-list">
                      {inspect.jsonFields.map((field) => (
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
                                disabled={busy}
                                onClick={() => void applyJsonField(field.path)}
                              >
                                Set
                              </button>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}

              {inspect.kind === "text" ? (
                <p className="muted small">
                  Text save detected. Use value search below for numeric
                  amounts stored as binary-compatible text patterns, or edit the
                  file externally if needed.
                </p>
              ) : null}

              {inspect.kind === "binary" || inspect.kind === "text" ? (
                <>
                  <p className="muted small">
                    Search for the current in-game value (gold, money, etc.),
                    then replace matches.
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
                          onChange={() => toggleKind(opt.id)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  <div className="row">
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => void runScan()}
                    >
                      Find values
                    </button>
                  </div>

                  {hits.length > 0 ? (
                    <>
                      <ul className="save-hit-list">
                        {hits.map((hit) => {
                          const key = hitKey(hit);
                          return (
                            <li key={key}>
                              <label className="save-hit">
                                <input
                                  type="checkbox"
                                  checked={selectedHits.has(key)}
                                  onChange={() => toggleHit(hit)}
                                />
                                <span>
                                  {hit.label} = {hit.value}
                                </span>
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
                        onClick={() => void applyBinaryReplace()}
                      >
                        Replace selected
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}

              {inspect.kind === "json" ? (
                <>
                  <p className="muted small">
                    Or search the raw file for a number if the field list missed
                    it:
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
                  <div className="row">
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => void runScan()}
                    >
                      Find in raw file
                    </button>
                  </div>
                  {hits.length > 0 ? (
                    <>
                      <ul className="save-hit-list">
                        {hits.map((hit) => {
                          const key = hitKey(hit);
                          return (
                            <li key={key}>
                              <label className="save-hit">
                                <input
                                  type="checkbox"
                                  checked={selectedHits.has(key)}
                                  onChange={() => toggleHit(hit)}
                                />
                                <span>
                                  {hit.label} = {hit.value}
                                </span>
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
                        />
                      </label>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy || selectedHits.size === 0}
                        onClick={() => void applyBinaryReplace()}
                      >
                        Replace selected
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {scanMessage ? <p className="muted small">{scanMessage}</p> : null}
        </>
      )}
    </section>
  );
}
