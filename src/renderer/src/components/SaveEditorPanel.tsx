import { useEffect, useMemo, useState } from "react";
import type { ActionResult, SaveFileEntry } from "../../../shared/types";
import { HexEditor } from "./HexEditor";

type Props = {
  gameId: string;
  savePath: string | null;
  isPremium: boolean;
  requirePremium: (feature: string) => boolean;
  runAction: (action: () => Promise<ActionResult>) => Promise<void>;
};

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
  const [message, setMessage] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);

  useEffect(() => {
    setFiles([]);
    setFilesTruncated(false);
    setFileFilter("");
    setMessage(null);
    setOpenFile(null);
  }, [gameId, savePath]);

  const filteredFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.relativePath.toLowerCase().includes(q));
  }, [files, fileFilter]);

  async function loadFiles() {
    if (!requirePremium("Save hex editor")) return;
    if (!savePath) {
      setMessage("Link a save folder first.");
      return;
    }
    setFilesLoading(true);
    setMessage(null);
    try {
      const res = await window.hub.listSaveFiles(gameId);
      if (!res.ok) {
        setMessage(res.error);
        setFiles([]);
        return;
      }
      setFiles(res.files ?? []);
      setFilesTruncated(!!res.truncated);
      if ((res.files?.length ?? 0) === 0) {
        setMessage("No files found in the linked save folder.");
      }
    } finally {
      setFilesLoading(false);
    }
  }

  function openHex(relativePath: string) {
    if (!requirePremium("Save hex editor")) return;
    setOpenFile(relativePath);
  }

  return (
    <section className="side-section">
      <h3>
        Hex editor{" "}
        {!isPremium ? <span className="premium-lock">Premium</span> : null}
      </h3>
      <p className="muted small">
        Open single-player save files as hex. Edit bytes directly, find values
        like money, and Hub backs up before every save.
      </p>

      {!savePath ? (
        <p className="muted small">Link a save folder above to browse files.</p>
      ) : (
        <>
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={filesLoading}
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
                      className="save-file"
                      onClick={() => openHex(file.relativePath)}
                    >
                      <span className="save-file-name">{file.relativePath}</span>
                      <span className="muted small">{file.sizeLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {message ? <p className="muted small">{message}</p> : null}
        </>
      )}

      {openFile ? (
        <HexEditor
          gameId={gameId}
          relativePath={openFile}
          runAction={runAction}
          onClose={() => setOpenFile(null)}
          onSaved={(msg) => setMessage(msg)}
        />
      ) : null}
    </section>
  );
}
