# The Hub

Unified game library for your PC.

## Features (v0.5)

- Steam, Epic, Ubisoft, GOG, Xbox/Game Pass (best-effort), Minecraft
- Launch, notes, save-folder linking
- Favorites, recently played, hide games, tags
- Sort by name / recent / playtime / store
- Grid density: compact / comfortable / big
- System tray + close to tray
- Steam playtime when available
- Add custom `.exe` games
- Auto-update via GitHub Releases (`amarri3795/the-hub`) — **NSIS install only**

### Premium (one-time, offline license)

Unlocks permanently after entering a valid license key (stored in local prefs):

- Collections / playlists (create, assign, filter) + Steam category import
- Save backups (create / restore / delete) — linking a save folder stays free
- Big Picture mode
- Per-game launch options (args, cwd, run as admin)
- Accent themes beyond the default blue

Free tier keeps scan, launch, search, favorites, recent, hide, basic tags, refresh, and add custom game.

Price display in-app: **$14.99** one-time (no built-in store checkout yet — customers enter a key you mint).

#### Mint license keys (owner)

Keys are HMAC-signed offline. Run from the repo:

```powershell
cd C:\Users\Amarri52\Projects\the-hub
node scripts/generate-license-key.mjs
node scripts/generate-license-key.mjs --count 5
node scripts/generate-license-key.mjs --owner
```

Format: `HUB-<16 hex>-<16 hex signature>`. Activate in the app under **Settings → License / Premium**.

Owner unlock (no key needed): Windows username `Amarri52` (case-insensitive), or set env `HUB_OWNER=1`. The `--owner` master key is optional backup.

## Dev

```powershell
cd C:\Users\Amarri52\Projects\the-hub
npm install
npm run dev
```

## Install & auto-updates

**Install once with the NSIS setup exe** from [GitHub Releases](https://github.com/amarri3795/the-hub/releases). That installed app checks `latest.yml` on launch and updates automatically.

- Use the Start Menu / desktop shortcut created by the installer — **not** a portable `.exe` shortcut.
- Portable builds are optional side downloads and **do not auto-update**.

Packaged NSIS builds use `electron-updater` against **amarri3795/the-hub**.

### Publish a release so updates work

1. Push the repo to GitHub (`amarri3795/the-hub`).
2. Bump `"version"` in `package.json` (e.g. `0.5.0`).
3. Build artifacts:

```powershell
npm run dist
```

4. Create a GitHub Release with tag matching the version (e.g. `v0.5.0`).
5. Upload from `release/`:
   - `TheHub-<version>-setup.exe` (NSIS — required for auto-update)
   - `latest.yml` (required)
   - `*.blockmap` if present
   - `TheHub-<version>-portable.exe` (optional)

Or publish in one step (needs `GH_TOKEN` with `repo` scope):

```powershell
$env:GH_TOKEN = "ghp_..."
npx electron-builder --win --publish always
```

Until a Release exists, the status line may say the update check was skipped — expected in early testing / `npm run dev`.

## Rebuild

```powershell
# NSIS installer + portable + latest.yml
npm run dist

# Installer only
npm run dist:nsis

# Portable only (no auto-update)
npm run dist:portable
```

Output:

- `release/TheHub-<version>-setup.exe`
- `release/latest.yml`
- `release/TheHub-<version>-portable.exe` (when using `npm run dist`)
