'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');

// ---------------------------------------------------------------------------
// Shared library logic (reused from the Electron app unchanged)
// ---------------------------------------------------------------------------
const libraryController = require('../assets/js/libraryController.js');
const { normalizePreferences, DEFAULT_PREFERENCES } = require('../assets/js/preferencesStore.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;

// LIBRARY_PATH can be overridden via env var (e.g. a Docker volume mount).
// Default: web/library/ (the baked-in sample library).
const LIBRARY_ROOT = path.resolve(
    process.env.LIBRARY_PATH || path.join(__dirname, 'library')
);

// preferences.json sits next to server.js; read-only at startup.
const PREFERENCES_PATH = path.join(__dirname, 'preferences.json');

// ---------------------------------------------------------------------------
// Load preferences once at startup
// ---------------------------------------------------------------------------
function loadPreferences() {
    try {
        const raw = JSON.parse(fs.readFileSync(PREFERENCES_PATH, 'utf8'));
        return normalizePreferences(raw);
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

const preferences = loadPreferences();

// ---------------------------------------------------------------------------
// In-memory projection state (shared across all WebSocket clients)
// ---------------------------------------------------------------------------
const projectionState = {
    isProjectionOn: false,
    currentSongPath: null,
    currentVerseText: null,  // the raw string sent to the projector
    isBlackScreen: false,
    preferences: null,       // last preferences:changed payload, for late-joining projectors
};

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Static files: public/
app.use(express.static(path.join(__dirname, 'public')));

// Shared JS modules from assets/js/ (songDisplay.js, i18n.js etc.) served as ES modules.
// The Dockerfile already copies assets/js/ into the image alongside web/.
app.use('/assets/js', express.static(path.join(__dirname, '../assets/js')));

// Locale JSON files served from the single source of truth in renderer/locales/.
// The Dockerfile copies the full repo context so this path is always available.
app.use('/locales', express.static(path.join(__dirname, '../renderer/locales')));

// ---------------------------------------------------------------------------
// API routes (all read-only)
// ---------------------------------------------------------------------------

// GET /projector — serve the projector page
app.get('/projector', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'projector.html'));
});

// GET /settings — serve the settings page (also served as an iframe from index.html)
app.get('/settings', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// GET /api/library — return the full library tree + songsById as plain objects
app.get('/api/library', (_req, res) => {
    try {
        const state = libraryController.buildLibraryState(LIBRARY_ROOT);
        // Convert the Maps to plain objects for JSON serialisation
        const songsById = Object.fromEntries(state.songsById);
        res.json({ tree: state.tree, songsById });
    } catch (err) {
        console.error('Failed to build library state', err);
        res.status(500).json({ error: 'Failed to load library' });
    }
});

// GET /api/song?path=<absolute-path> — return a single song JSON
app.get('/api/song', (req, res) => {
    const requestedPath = req.query.path;

    if (!requestedPath) {
        return res.status(400).json({ error: 'Missing path parameter' });
    }

    // Security: resolve and verify the path stays inside LIBRARY_ROOT
    const resolved = path.resolve(requestedPath);
    if (!resolved.startsWith(LIBRARY_ROOT + path.sep) && resolved !== LIBRARY_ROOT) {
        return res.status(403).json({ error: 'Path outside library root' });
    }

    try {
        const content = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        res.json(content);
    } catch {
        res.status(404).json({ error: 'Song not found' });
    }
});

// GET /api/preferences — return display preferences
app.get('/api/preferences', (_req, res) => {
    res.json(preferences);
});

// GET /api/state — return current projection state (useful for late-joining clients)
app.get('/api/state', (_req, res) => {
    res.json(projectionState);
});

// Serve background images from the library root directory
// e.g. GET /assets/background-image.png → LIBRARY_ROOT/../background-image.png
// We look for them one level up from LIBRARY_ROOT (same directory as preferences.json)
app.use('/assets', express.static(path.dirname(LIBRARY_ROOT)));

// ---------------------------------------------------------------------------
// HTTP server + WebSocket server (on the same port)
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(data, excludeSocket) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client !== excludeSocket && client.readyState === 1 /* OPEN */) {
            client.send(message);
        }
    });
}

function broadcastAll(data) {
    broadcast(data, null);
}

wss.on('connection', (ws) => {
    // Immediately sync new client with current state
    ws.send(JSON.stringify({ type: 'state:sync', payload: projectionState }));

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        const { type, payload } = msg;

        switch (type) {
            case 'projection:toggle': {
                projectionState.isProjectionOn = !projectionState.isProjectionOn;
                if (!projectionState.isProjectionOn) {
                    projectionState.currentVerseText = null;
                    projectionState.isBlackScreen = false;
                }
                broadcastAll({ type: 'state:sync', payload: projectionState });
                break;
            }

            case 'display:lyrics': {
                if (typeof payload?.text === 'string') {
                    projectionState.currentVerseText = payload.text;
                    projectionState.isBlackScreen = false;
                    projectionState.isProjectionOn = true;
                    broadcastAll({ type: 'display:lyrics', payload: { text: payload.text } });
                    // Also update state so late joiners get the current lyrics
                    broadcastAll({ type: 'state:sync', payload: projectionState });
                }
                break;
            }

            case 'display:black': {
                projectionState.isBlackScreen = true;
                projectionState.currentVerseText = null;
                broadcastAll({ type: 'display:black' });
                broadcastAll({ type: 'state:sync', payload: projectionState });
                break;
            }

            case 'song:selected': {
                if (typeof payload?.path === 'string' || payload?.path === null) {
                    projectionState.currentSongPath = payload.path;
                    broadcast({ type: 'state:sync', payload: projectionState }, ws);
                }
                break;
            }

            case 'preferences:changed': {
                if (payload && typeof payload === 'object') {
                    projectionState.preferences = payload;
                    // Broadcast to all clients (projector popup needs it)
                    broadcastAll({ type: 'preferences:changed', payload });
                }
                break;
            }

            default:
                break;
        }
    });

    ws.on('error', (err) => {
        console.warn('WebSocket error', err.message);
    });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
    console.log(`Beamee web server running at http://localhost:${PORT}`);
    console.log(`Library root: ${LIBRARY_ROOT}`);
});
