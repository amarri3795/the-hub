import hubMark from "../assets/hub-mark.svg";

export function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <img className="titlebar-logo" src={hubMark} alt="" />
        <span className="titlebar-brand">The Hub</span>
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="win-btn"
          aria-label="Minimize"
          onClick={() => void window.hub.windowMinimize()}
        >
          ─
        </button>
        <button
          type="button"
          className="win-btn"
          aria-label="Maximize"
          onClick={() => void window.hub.windowMaximize()}
        >
          □
        </button>
        <button
          type="button"
          className="win-btn close"
          aria-label="Close"
          onClick={() => void window.hub.windowClose()}
        >
          ×
        </button>
      </div>
    </div>
  );
}
