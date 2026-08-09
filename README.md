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
- Auto-update via GitHub Releases (`amarri3795/the-hub`)

## Dev

```powershell
cd C:\Users\Amarri52\Projects\the-hub
npm install
npm run dev
```

## Auto-updates (GitHub Releases)

Packaged builds use `electron-updater` against **amarri3795/the-hub**.

### Publish a release so updates work

1. Push the repo to GitHub (`amarri3795/the-hub`).
2. Bump `"version"` in `package.json` (e.g. `0.4.0`).
3. Build artifacts:

```powershell
npm run dist:portable
```

4. Create a GitHub Release with tag matching the version (e.g. `v0.4.0`).
5. Upload the files from `release/` — at minimum the portable exe **and** the generated `latest.yml` (electron-builder writes this next to the installer when configured for GitHub publish).

Or publish in one step (needs `GH_TOKEN` with `repo` scope):

```powershell
$env:GH_TOKEN = "ghp_..."
npx electron-builder --win portable --publish always
```

Until a Release exists, the status line may say the update check was skipped — expected in early testing / `npm run dev`.

## Rebuild portable exe

```powershell
npm run dist:portable
```

Output: `release/TheHub-<version>-portable.exe`
