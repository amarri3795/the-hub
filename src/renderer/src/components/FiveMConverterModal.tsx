import { useState } from "react";
import type { FiveMConvertResult } from "../../../shared/types";

type Props = {
  open: boolean;
  isPremium: boolean;
  onClose: () => void;
  requirePremium: (feature: string) => boolean;
};

export function FiveMConverterModal({
  open,
  isPremium,
  onClose,
  requirePremium,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FiveMConvertResult | null>(null);

  if (!open) return null;

  async function runConvert(kind: "zip" | "folder") {
    if (!requirePremium("FiveM → Story Mode converter")) return;
    setBusy(true);
    setResult(null);
    try {
      // 1) Pick SOURCE (zip or folder) — separate dialogs on Windows
      const picked = await window.hub.pickFiveMVehicleSource(kind);
      if (!picked.ok || !picked.path) {
        setResult({
          ok: false,
          error: picked.ok ? "No file selected." : picked.error,
        });
        return;
      }
      // 2) Convert — then asks where to SAVE the .oiv output
      const res = await window.hub.convertFiveMToOiv(picked.path, kind);
      setResult(res);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="premium-modal fivem-modal"
        role="dialog"
        aria-labelledby="fivem-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="premium-kicker">
          Premium tool{" "}
          {!isPremium ? <span className="premium-lock">Locked</span> : null}
        </p>
        <h2 id="fivem-title">FiveM → Story Mode car converter</h2>
        <p className="muted">
          Pick a FiveM vehicle <strong>.zip</strong> or unpacked{" "}
          <strong>folder</strong> (<code>data/</code> + <code>stream/</code>).
          Hub then asks where to save the OpenIV <code>.oiv</code> (that second
          dialog is output-only).
        </p>
        <ol className="fivem-steps">
          <li>Pick the FiveM car zip or folder</li>
          <li>Save the generated <code>.oiv</code> (default: Downloads)</li>
          <li>
            OpenIV → Tools → Package Installer → install into the{" "}
            <strong>mods</strong> folder
          </li>
        </ol>

        <div className="row modal-actions">
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => void runConvert("zip")}
          >
            {busy ? "Working…" : "Convert from .zip"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void runConvert("folder")}
          >
            Convert from folder
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {result ? (
          <div className={`fivem-result ${result.ok ? "ok" : "err"}`}>
            {result.ok ? (
              <>
                <p>
                  <strong>Spawn name:</strong>{" "}
                  <code>{result.spawnName}</code>
                </p>
                <p className="muted small">{result.message}</p>
                {result.outputPath ? (
                  <div className="row">
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void window.hub.showInFolder(result.outputPath!)
                      }
                    >
                      Show .oiv in folder
                    </button>
                  </div>
                ) : null}
                <p className="muted small">
                  After install, spawn with:{" "}
                  <code>{result.spawnName}</code>
                </p>
              </>
            ) : (
              <p>{result.error}</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
