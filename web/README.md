# Beamee — Web / Docker version

A self-contained browser-based version of Beamee that runs as a Node.js + Express server inside a Docker container (or locally). It exposes the full projection workflow through two browser tabs: a **control UI** and a **projector display**.

---

## Architecture overview

```
repo root/
├── assets/js/          ← shared song/library/preferences logic (used by both Electron and web)
└── web/
    ├── server.js        ← Express API + WebSocket projection bus
    ├── preferences.json ← server-side default display preferences
    ├── library/         ← default baked-in sample songs
    ├── Dockerfile
    ├── docker-compose.yml
    └── public/
        ├── index.html       ← control UI
        ├── settings.html    ← preferences page (opened as overlay)
        ├── projector.html   ← fullscreen lyrics display
        ├── css/output.css   ← compiled Tailwind/DaisyUI (see CSS section)
        └── js/
            ├── control.js
            ├── settings.js
            └── projector.js
```

**Key design points:**

- `web/` is a completely separate Node.js app with its own `package.json` and `node_modules`. It does not interfere with the Electron app at the repo root.
- `assets/js/` is shared: `server.js` reaches it via `require('../assets/js/...')`. The Dockerfile copies it alongside `web/`.
- There is no user authentication and no song editing. The library is read-only.
- Real-time sync between the control tab and the projector popup uses a WebSocket bus on the server. Multiple control clients (phone + laptop) can coexist.

---

## How it works

### Two-browser-tab projection

1. Open `http://localhost:3000` — the **control UI**.
2. Click the **play button** (▶) in the bottom control bar — this opens the **projector** as a popup window.
3. Drag the popup to your second screen and press F11 (or the browser's fullscreen shortcut).
4. Click any verse in the control UI to project it. The projector updates in real time via WebSocket.
5. Click the **stop button** (■) to close the projector popup.

### Keyboard shortcuts (control UI)

| Key | Action |
|---|---|
| `→` or `n` | Next verse |
| `←` or `p` | Previous verse |
| `r` | Jump to chorus |
| `b` | Black screen |
| `Cmd/Ctrl + P` | Toggle projection (open/close projector) |

### Settings

Click the gear icon (⚙) in the bottom-right of the control bar to open the settings overlay.

- **Projection** — font, size, line height, colors, paddings. Saved to browser `localStorage`; persists across page refreshes but not across different browsers/devices.
- **Appearance** — UI theme (DaisyUI themes). Also saved to `localStorage`.
- **General** — language preference (stored, UI is English-only in this version).
- **About** — links to GitHub and Ko-fi.

Settings changes are broadcast via WebSocket so the projector popup updates immediately.

> **Background image:** Cannot be picked from the browser. Set `backgroundImage` in `web/preferences.json` on the server (filename relative to the library directory) before starting the server.

---

## Running locally (without Docker)

```sh
# Install dependencies (one-time)
cd web
npm install

# Start the server
node server.js
# → http://localhost:3000
```

The server uses the `web/library/` folder as the default song library.

Override the port or library path:

```sh
PORT=8080 LIBRARY_PATH=/path/to/my/songs node server.js
```

---

## Docker

### Quick start (sample library)

```sh
# From the repo root:
docker compose -f web/docker-compose.yml up --build
# → http://localhost:3000
```

### With your own song library

Edit `web/docker-compose.yml` and uncomment the `volumes` and `LIBRARY_PATH` lines:

```yaml
services:
  beamee:
    build:
      context: ..
      dockerfile: web/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - LIBRARY_PATH=/library
    volumes:
      - /absolute/path/to/your/songs:/library:ro
    restart: unless-stopped
```

Or pass everything directly with `docker run`:

```sh
docker run -p 3000:3000 \
  -e LIBRARY_PATH=/library \
  -v /absolute/path/to/your/songs:/library:ro \
  beamee-web
```

The `:ro` flag mounts the library read-only — the server never writes to it.

### Build context

The Dockerfile's build context is the **repo root** (not `web/`). This is required so the image can copy `assets/js/`. Always run `docker compose` or `docker build` from the repo root, or use the `context: ..` setting already in `docker-compose.yml`.

---

## Song library format

Songs are `.json` files following the Beamee schema (same as the desktop app). See `assets/js/songSchema.js` for validation rules. Key fields:

```json
{
  "schemaVersion": 1,
  "id": "my-song-slug",
  "name": "My Song",
  "authors": ["Author Name"],
  "collections": [
    { "name": "My Collection", "collectionId": "my-collection", "reference": "COL", "number": 1 }
  ],
  "sections": [
    { "id": "verse-1", "type": "verse", "title": "Verse 1", "lines": ["Line one", "Line two"] },
    { "id": "chorus-1", "type": "chorus", "title": "Chorus", "lines": ["Chorus line"] }
  ],
  "arrangement": [
    { "sectionId": "verse-1" },
    { "sectionId": "chorus-1" }
  ]
}
```

Valid section types: `verse`, `chorus`, `pre-chorus`, `bridge`, `intro`, `outro`, `tag`, `other`.

Organise songs into collections by placing them in subdirectories inside the library folder. The folder name becomes the collection name in the sidebar.

---

## Server-side preferences (`preferences.json`)

`web/preferences.json` sets the **default** display preferences served to new clients (or clients that have never saved their own settings). Once a user saves settings in the browser, their `localStorage` values take precedence.

| Field | Type | Description |
|---|---|---|
| `fontFamily` | string | Projection font (must be available on the client) |
| `fontSize` | number | Base font size in px (scaled to 1280px wide projector) |
| `textColor` | string | CSS hex colour for lyrics text |
| `backgroundColor` | string | CSS hex colour for projector background |
| `backgroundImage` | string \| null | Filename of an image in the library directory, or `null` |
| `lineHeight` | number | CSS line-height multiplier |
| `paddingTop/Bottom/Left/Right` | number | Projector padding in px |
| `useArrangement` | boolean | Whether the arrangement order is used by default |
| `theme` | string | DaisyUI theme name (e.g. `"dark"`, `"light"`) |
| `language` | string | `"en"`, `"fr"`, or `"system"` |

---

## CSS / Tailwind

`web/public/css/output.css` is the compiled Tailwind + DaisyUI stylesheet.

**Docker builds** always overwrite it with `renderer/css/output.css` from the same commit (hardcoded in the Dockerfile), so Docker images are never stale even if the manual sync was missed.

**Local development** — after modifying `renderer/css/style.css` or the Tailwind config, run the following from the **repo root** to rebuild and sync both destinations at once:

```sh
npm run build-tailwind:web
```

This compiles Tailwind to `renderer/css/output.css` and copies the result to `web/public/css/output.css`.

---

## API reference

All endpoints are read-only (`GET` only). No authentication.

| Endpoint | Description |
|---|---|
| `GET /` | Control UI (`index.html`) |
| `GET /projector` | Projector display (`projector.html`) |
| `GET /settings` | Settings page (`settings.html`) |
| `GET /api/library` | Full library tree + `songsById` map as JSON |
| `GET /api/song?path=<abs-path>` | Single song JSON (path must resolve inside the library root) |
| `GET /api/preferences` | Server-side default preferences |
| `GET /api/state` | Current projection state snapshot |
| `GET /assets/*` | Static files from the library directory (background images) |

### WebSocket messages

Connect to `ws://localhost:3000`. On connect the server immediately pushes the current state.

**Client → server:**

| Type | Payload | Effect |
|---|---|---|
| `projection:toggle` | — | Opens/closes projection state |
| `display:lyrics` | `{ text: string }` | Projects a verse |
| `display:black` | — | Clears the projector screen |
| `song:selected` | `{ path: string }` | Updates current song in server state |
| `preferences:changed` | preferences object | Broadcasts updated preferences to all clients |

**Server → client (broadcast):**

| Type | Payload | Description |
|---|---|---|
| `state:sync` | full state object | Sent on connect and after any state change |
| `display:lyrics` | `{ text: string }` | A verse is being projected |
| `display:black` | — | Screen cleared |
| `preferences:changed` | preferences object | Preferences were updated by a client |

---

## What is not supported

Compared to the desktop app, the following are intentionally absent:

- Song creation, editing, import, or export
- Favorites / playlists
- ChordPro import
- Background image picker (set in `preferences.json` instead)
- Auto-updater
- Native OS menus and system-level keyboard shortcuts
- PDF export
- Per-user accounts or authentication
