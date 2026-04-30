'use strict';

// ---------------------------------------------------------------------------
// Projector page — browser WebSocket client
// Mirrors renderer/js/projector.js but uses WebSocket instead of ipcRenderer
// ---------------------------------------------------------------------------

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

let ws = null;
let reconnectTimer = null;

// ---------------------------------------------------------------------------
// Preferences / styling
// ---------------------------------------------------------------------------

function applyPreferences(preferences) {
    if (!preferences) {
        return;
    }

    document.body.style.fontFamily = preferences.fontFamily;
    document.body.style.fontSize = `${preferences.fontSize}px`;
    document.body.style.color = preferences.textColor;
    document.body.style.backgroundColor = preferences.backgroundColor;
    document.body.style.lineHeight = String(preferences.lineHeight);

    if (preferences.backgroundImage) {
        document.body.style.backgroundImage = `url('/assets/${preferences.backgroundImage}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    } else {
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
    }
}

// ---------------------------------------------------------------------------
// Lyrics rendering
// ---------------------------------------------------------------------------

function appendTextWithLineBreaks(parent, value) {
    const text = String(value ?? '');
    const lines = text.split('\n');

    lines.forEach((line, index) => {
        if (index > 0) {
            parent.appendChild(document.createElement('br'));
        }
        parent.appendChild(document.createTextNode(line));
    });
}

function displayLyrics(text) {
    const lyricsRoot = document.getElementById('lyrics');
    lyricsRoot.replaceChildren();

    const paragraph = document.createElement('p');
    appendTextWithLineBreaks(paragraph, text);
    lyricsRoot.appendChild(paragraph);
}

function clearLyrics() {
    document.getElementById('lyrics').replaceChildren();
}

// ---------------------------------------------------------------------------
// State sync — apply full projection state when joining or reconnecting
// ---------------------------------------------------------------------------

function applyState(state) {
    if (!state) {
        return;
    }

    if (state.isBlackScreen || !state.isProjectionOn) {
        clearLyrics();
        return;
    }

    if (state.currentVerseText) {
        displayLyrics(state.currentVerseText);
    } else {
        clearLyrics();
    }
}

// ---------------------------------------------------------------------------
// WebSocket connection with auto-reconnect
// ---------------------------------------------------------------------------

function connect() {
    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => {
        clearTimeout(reconnectTimer);
    });

    ws.addEventListener('message', (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return;
        }

        const { type, payload } = msg;

        switch (type) {
            case 'state:sync':
                // Apply preferences from state if the server has a stored value
                // (happens when projector opens after preferences were changed)
                if (payload?.preferences) {
                    applyPreferences(payload.preferences);
                }
                applyState(payload);
                break;

            case 'display:lyrics':
                if (typeof payload?.text === 'string') {
                    displayLyrics(payload.text);
                }
                break;

            case 'display:black':
                clearLyrics();
                break;

            case 'preferences:changed':
                if (payload) {
                    applyPreferences(payload);
                }
                break;

            default:
                break;
        }
    });

    ws.addEventListener('close', () => {
        reconnectTimer = setTimeout(connect, 2000);
    });

    ws.addEventListener('error', () => {
        ws.close();
    });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Load preferences: localStorage first (set by control UI), fall back to server
    let storedPrefs = null;
    try {
        const raw = localStorage.getItem('beamee_preferences');
        if (raw) storedPrefs = JSON.parse(raw);
    } catch {
        // ignore
    }

    if (storedPrefs) {
        applyPreferences(storedPrefs);
        connect();
    } else {
        fetch('/api/preferences')
            .then((r) => r.json())
            .then(applyPreferences)
            .catch(() => {})
            .finally(() => connect());
    }
});
