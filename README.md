# The Hub

Unified game library for your PC.

## Features (v0.4)

- Steam, Epic, Ubisoft, GOG, Xbox/Game Pass (best-effort), Minecraft
- Launch, notes, save backups
- Favorites, recently played, hide games, tags
- Collections / playlists (create, assign, filter)
- Import Steam categories → Hub collections + tags
- Sort by name / recent / playtime / store
- Grid density: compact / comfortable / big
- Accent theme picker
- Per-game launch options (args, cwd, run as admin)
- System tray + close to tray
- Big Picture with keyboard + gamepad focus
- Steam playtime when available
- Add custom `.exe` games
- Auto-update via GitHub Releases (`amarri3795/the-hub`) — **NSIS install only**

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
2. Bump `"version"` in `package.json` (e.g. `0.4.1`).
3. Build artifacts:

```powershell
npm run dist
```

4. Create a GitHub Release with tag matching the version (e.g. `v0.4.1`).
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
