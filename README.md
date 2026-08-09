# The Hub

Unified game library for your PC. **v0.1** reads your **Steam** installs and launches games from one window.

## Run locally (free)

```powershell
cd C:\Users\Amarri52\Projects\the-hub
npm install
npm run dev
```

Requirements: Node.js, Steam installed with at least one game.

## What works now

- Detect Steam install path (common folders + Windows registry)
- Scan all Steam library folders
- Show covers + search
- **Launch** via `steam://rungameid/...`

## Next (later)

- Epic / other stores
- Save backups / per-game tools
- Packaged `.exe` installer for free download

## Note

Steam may still open in the background when a game launches — that’s normal for store-connected titles.
