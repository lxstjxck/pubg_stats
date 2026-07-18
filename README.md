# PUBG Ranked Overlay for OBS

A desktop helper app and local OBS browser overlay that shows PUBG ranked stats for a selected player.

The recommended version is the Tauri desktop app. It stores the PUBG API key locally on the user's computer, starts a local overlay server, and gives the user an OBS Browser source URL.

## Features

- Tauri desktop app for Windows builds
- Built-in local overlay server for OBS
- PUBG ranked stats fetched through the official PUBG API
- Transparent OBS browser overlay
- One-time local API key setup in the desktop app
- Simple URL parameters for player, platform, mode, and refresh interval

## Project Structure

- `app/` - Tauri desktop UI
- `src-tauri/` - Tauri Rust backend and local OBS overlay server
- `public/overlay.html` - overlay markup
- `public/overlay.css` - overlay styles
- `public/overlay.js` - overlay refresh and rendering logic
- `server.js` - legacy Node development server
- `setup.bat` - first-time Windows setup helper
- `start.bat` - Windows start helper
- `.env.example` - example local environment file

## Requirements

- Node.js 18 or newer for development
- Rust and Cargo for Tauri development/builds
- WebView2 Runtime on Windows
- PUBG API key from the PUBG Developer Portal

## Desktop App Development

Install dependencies:

```bash
npm install
```

Run the Tauri app in development mode:

```bash
npm run tauri:dev
```

Build the desktop app:

```bash
npm run tauri:build
```

The built installer/binaries are created by Tauri under:

```text
src-tauri/target/release/bundle/
```

## User Flow

1. Open the desktop app.
2. Paste a PUBG API key once.
3. Enter player nickname, platform, ranked mode, refresh interval, and port.
4. Save settings.
5. Copy the generated OBS URL.
6. Add that URL as an OBS Browser source.

Example OBS Browser URL:

```text
http://localhost:3000/overlay.html?platform=steam&player=YOUR_NICK&mode=fpp-squad&refresh=60000
```

Replace `YOUR_NICK` with the PUBG player nickname.

## Legacy Node Mode

The project still includes a Node/Express server for quick local testing without Tauri.

Install dependencies if needed:

```bash
npm install
```

Create a local `.env` file:

```env
PUBG_API_KEY=YOUR_PUBG_API_KEY
PORT=3000
```

Start the server:

```bash
npm start
```

Open the overlay URL:

```text
http://localhost:3000/overlay.html?platform=steam&player=YOUR_NICK&mode=fpp-squad&refresh=60000
```

## Overlay URL Parameters

- `platform` - PUBG platform shard, for example `steam`, `xbox`, or `psn`
- `player` - PUBG player nickname, required
- `mode` - ranked mode: `tpp-duo`, `tpp-squad`, `fpp-duo`, or `fpp-squad`
- `refresh` - refresh interval in milliseconds, default is `60000`

## Overlay Error Messages

- `Missing API key` - the PUBG API key is not saved in the desktop app.
- `Invalid API key` - PUBG API rejected the saved key. Check the key in app settings.
- `API key forbidden` - PUBG API denied access for this key. The key may be blocked or not allowed to use this endpoint.
- `Rate limit` - too many PUBG API requests. Increase `refresh` or wait a few minutes.
- `Network error` - the app could not connect to PUBG API. Check the internet connection.
- `PUBG API unavailable` - PUBG API returned a server-side error. Try again later.
- `Player not found` - PUBG API did not find this player on the selected platform.
- `No ranked stats` - the player has no ranked stats for the current season.
- `Mode unavailable` - the player has ranked stats, but not for the selected mode.
- `Invalid mode` - the URL mode is not one of `tpp-duo`, `tpp-squad`, `fpp-duo`, or `fpp-squad`.

## Adding the Overlay to OBS

1. Open OBS.
2. Go to `Sources`.
3. Click `+`.
4. Select `Browser`.
5. Paste the overlay URL.
6. Set the width and height for your scene.
7. Keep the background transparent.

## API Key Handling

Do not commit your PUBG API key to GitHub.

The recommended desktop setup is:

- The user enters the key once in the Tauri app.
- The app stores it in the user's local app config directory.
- The key is not included in OBS URLs.
- The key is not included in frontend JavaScript.
- The key is not committed to GitHub.

For legacy Node mode, `.env` is also supported and ignored by Git.

## Alternative Deployment Options

For a public project, there are three realistic ways to handle the API key:

1. Desktop app with local key, recommended for this project.
   Each user gets their own PUBG API key and stores it locally in the app config. This is safe for GitHub and does not require your hosted backend.

2. Hosted backend proxy.
   You host a server with your own API key and the overlay talks to your backend. This is easier for users, but you must handle rate limits, abuse protection, hosting cost, and key security.

3. Legacy local Node app.
   Users run `setup.bat` and `start.bat`. This is simpler for development, but a packaged Tauri app is better for non-technical users.

Do not put the API key in frontend JavaScript, OBS URLs, or public repository files. Anything shipped to the browser or GitHub should be treated as public.
