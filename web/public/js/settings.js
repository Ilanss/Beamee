'use strict';

// ---------------------------------------------------------------------------
// Beamee Web — Settings page controller
//
// Adapted from renderer/js/preferences.js.
// - ipcRenderer calls replaced with localStorage + fetch
// - queryLocalFonts() replaced with a static fallback list
// - Background image picker removed (read-only display)
// - Language select saves to localStorage immediately
// - Theme cards, projection form, save/reset/restore all work identically
// - Saved preferences are broadcast via WebSocket so the projector updates live
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'beamee_preferences';

const FALLBACK_FONTS = [
    'Arial', 'Arial Black', 'Courier New', 'Georgia', 'Impact',
    'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype',
    'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
    'MS Sans Serif', 'MS Serif',
];

const COLOR_FIELD_IDS = ['text-color', 'background-color'];
const PAGES_WITH_ACTIONS = new Set(['settings-projection', 'settings-appearence']);

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadStoredPreferences() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveStoredPreferences(prefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Storage quota exceeded or private browsing — silently continue.
    }
}

// ---------------------------------------------------------------------------
// WebSocket (reuse the same connection opened by control.js if on the same
// page, otherwise open a fresh one for the standalone settings page)
// ---------------------------------------------------------------------------

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
let _ws = null;

function getWs() {
    // If control.js is on the same page it exposes window.__beameeWs
    if (window.__beameeWs && window.__beameeWs.readyState === WebSocket.OPEN) {
        return window.__beameeWs;
    }
    if (_ws && _ws.readyState === WebSocket.OPEN) {
        return _ws;
    }
    _ws = new WebSocket(WS_URL);
    return _ws;
}

function wsBroadcastPreferences(prefs) {
    const socket = getWs();
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'preferences:changed', payload: prefs }));
    } else if (socket) {
        // Wait for open then send
        socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ type: 'preferences:changed', payload: prefs }));
        }, { once: true });
    }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let currentPreferences = null;
let selectedTheme = null;
let currentMenuPage = 'settings-projection';
let isDirty = false;

// DOM refs (populated in init)
let fontSelect = null;
let projectionForm = null;
let saveButton = null;
let restoreDefaultsButton = null;
let resetButton = null;
let closeButton = null;
let backgroundImageNameEl = null;
let languageSelect = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getField(id) {
    return document.getElementById(id);
}

function getColorTrigger(id) {
    return document.querySelector(`[data-color-trigger="${id}"]`);
}

function getColorSwatch(id) {
    return document.querySelector(`[data-color-swatch="${id}"]`);
}

function getColorValue(id) {
    return document.querySelector(`[data-color-value="${id}"]`);
}

function syncColorFieldPreview(id) {
    const input = getField(id);
    const swatch = getColorSwatch(id);
    const value = getColorValue(id);
    if (!input) return;
    const color = input.value || '#000000';
    if (swatch) swatch.style.backgroundColor = color;
    if (value) value.textContent = color.toUpperCase();
}

function bindColorField(id) {
    const input = getField(id);
    const trigger = getColorTrigger(id);
    if (!input || !trigger) return;

    trigger.addEventListener('click', () => {
        if (typeof input.showPicker === 'function') {
            input.showPicker();
        } else {
            input.click();
        }
    });
    input.addEventListener('input', () => syncColorFieldPreview(id));
    input.addEventListener('change', () => syncColorFieldPreview(id));
    syncColorFieldPreview(id);
}

function addFontOption(font) {
    if (!font || !fontSelect) return;
    if (Array.from(fontSelect.options).some((o) => o.value === font)) return;
    const option = document.createElement('option');
    option.value = font;
    option.text = font;
    fontSelect.add(option);
}

function populateFontOptions(fonts) {
    if (!fontSelect) return;
    fontSelect.innerHTML = '';
    fonts.forEach(addFontOption);
}

function setInputValue(id, value) {
    const el = getField(id);
    if (el) el.value = value;
    if (COLOR_FIELD_IDS.includes(id)) syncColorFieldPreview(id);
}

function readNumericValue(id, fallback, parser = Number.parseFloat) {
    const el = getField(id);
    if (!el) return fallback;
    const parsed = parser(el.value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function getStatusElement() {
    const map = {
        'settings-projection': 'status-projection',
        'settings-appearence': 'status-appearence',
        'settings-general':    'status-general',
    };
    const id = map[currentMenuPage];
    return id ? document.getElementById(id) : null;
}

function showStatus(message, isError = false) {
    const el = getStatusElement();
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('text-error', isError);
    el.classList.toggle('text-success', !isError);
}

// ---------------------------------------------------------------------------
// Dirty / action bar
// ---------------------------------------------------------------------------

function setDirty(value) {
    isDirty = value;
    if (!saveButton) return;
    saveButton.classList.toggle('btn-primary', value);
    saveButton.classList.toggle('btn-disabled', !value);
}

function updateActionBarVisibility() {
    const show = PAGES_WITH_ACTIONS.has(currentMenuPage);
    if (saveButton) saveButton.hidden = !show;
    if (restoreDefaultsButton) restoreDefaultsButton.hidden = !show;
    if (resetButton) resetButton.hidden = !show;
    setDirty(false);
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function resolveTheme(theme) {
    if (theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme || 'dark';
}

function applyThemeToDocument(theme) {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

// ---------------------------------------------------------------------------
// Page switching
// ---------------------------------------------------------------------------

function loadMenu(menuPage) {
    if (!menuPage) return;
    document.querySelectorAll('.menu-page').forEach((el) => { el.hidden = true; });
    const target = document.getElementById(menuPage);
    if (target) target.hidden = false;
    currentMenuPage = menuPage;
    updateActionBarVisibility();
}

// ---------------------------------------------------------------------------
// Apply preferences → form
// ---------------------------------------------------------------------------

function applyBackgroundImageToForm(backgroundImage) {
    const hasImage = typeof backgroundImage === 'string' && backgroundImage.trim();
    if (backgroundImageNameEl) {
        backgroundImageNameEl.textContent = hasImage ? backgroundImage : 'No image set';
        backgroundImageNameEl.classList.toggle('opacity-50', !hasImage);
    }
}

function applyPreferencesToForm(preferences) {
    if (!fontSelect || !preferences) return false;
    currentPreferences = preferences;

    if (languageSelect && preferences.language) {
        languageSelect.value = preferences.language;
    }

    populateFontOptions(FALLBACK_FONTS);
    addFontOption(preferences.fontFamily);
    fontSelect.value = preferences.fontFamily;

    setInputValue('font-size', preferences.fontSize);
    setInputValue('line-height', preferences.lineHeight);
    setInputValue('text-color', preferences.textColor);
    setInputValue('background-color', preferences.backgroundColor);
    setInputValue('padding-top', preferences.paddingTop);
    setInputValue('padding-bottom', preferences.paddingBottom);
    setInputValue('padding-left', preferences.paddingLeft);
    setInputValue('padding-right', preferences.paddingRight);

    applyBackgroundImageToForm(preferences.backgroundImage ?? null);

    // Theme cards
    const themeCards = document.querySelectorAll('[data-set-theme]');
    const availableThemes = new Set(Array.from(themeCards).map((c) => c.dataset.setTheme));
    const theme = availableThemes.has(preferences.theme) ? preferences.theme : 'dark';
    selectedTheme = theme;
    themeCards.forEach((card) => {
        card.classList.toggle('outline-base-content!', card.dataset.setTheme === theme);
    });
    applyThemeToDocument(theme);

    return true;
}

// ---------------------------------------------------------------------------
// Read form → preferences object
// ---------------------------------------------------------------------------

function readProjectionPreferences() {
    return {
        fontFamily:      fontSelect?.value || currentPreferences?.fontFamily,
        fontSize:        readNumericValue('font-size', currentPreferences?.fontSize, Number.parseInt),
        textColor:       getField('text-color')?.value,
        backgroundColor: getField('background-color')?.value,
        lineHeight:      readNumericValue('line-height', currentPreferences?.lineHeight),
        paddingTop:      readNumericValue('padding-top', currentPreferences?.paddingTop, Number.parseInt),
        paddingBottom:   readNumericValue('padding-bottom', currentPreferences?.paddingBottom, Number.parseInt),
        paddingLeft:     readNumericValue('padding-left', currentPreferences?.paddingLeft, Number.parseInt),
        paddingRight:    readNumericValue('padding-right', currentPreferences?.paddingRight, Number.parseInt),
    };
}

function readAppearencePreferences() {
    return {
        theme:    selectedTheme || currentPreferences?.theme || 'dark',
        language: languageSelect?.value || currentPreferences?.language || 'en',
    };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

function mergeAndSave(updates) {
    const merged = Object.assign({}, currentPreferences, updates);
    currentPreferences = merged;
    saveStoredPreferences(merged);
    // Notify control UI on the same page
    window.dispatchEvent(new CustomEvent('beameePreferencesChanged', { detail: merged }));
    // Notify projector popup via WebSocket
    wsBroadcastPreferences(merged);
    return merged;
}

function savePreferencesFromForm() {
    try {
        showStatus('Saving...');
        const updates = currentMenuPage === 'settings-appearence'
            ? readAppearencePreferences()
            : readProjectionPreferences();

        const saved = mergeAndSave(updates);
        applyPreferencesToForm(saved);
        setDirty(false);
        showStatus('Preferences saved.');
    } catch (err) {
        console.error('Failed to save preferences', err);
        showStatus('Failed to save preferences.', true);
    }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
    fontSelect             = document.getElementById('font-family');
    projectionForm         = document.getElementById('form-projection');
    saveButton             = document.getElementById('save-preferences');
    restoreDefaultsButton  = document.getElementById('restore-defaults');
    resetButton            = document.getElementById('reset-preferences');
    closeButton            = document.getElementById('settings-close');
    backgroundImageNameEl  = document.getElementById('background-image-name');
    languageSelect         = document.getElementById('app-language');

    // --- Sidebar nav ---
    document.querySelector('.sidebar').addEventListener('click', (e) => {
        const item = e.target.closest('li[data-settings-id]');
        if (!item) return;
        const menuPage = item.dataset.settingsId;
        if (menuPage === currentMenuPage) return;

        if (isDirty) {
            if (!window.confirm('You have unsaved changes. Leave without saving?')) return;
            if (currentPreferences) applyPreferencesToForm(currentPreferences);
        }

        document.querySelectorAll('.sidebar li a.menu-active').forEach((a) => a.classList.remove('menu-active'));
        item.querySelector('a')?.classList.add('menu-active');
        loadMenu(menuPage);
    });

    // --- Color fields ---
    COLOR_FIELD_IDS.forEach(bindColorField);

    // --- Theme cards ---
    document.getElementById('settings-appearence').addEventListener('click', (e) => {
        const card = e.target.closest('[data-set-theme]');
        if (!card) return;
        const theme = card.dataset.setTheme;
        if (!theme) return;
        selectedTheme = theme;
        document.querySelectorAll('[data-set-theme]').forEach((c) => {
            c.classList.toggle('outline-base-content!', c === card);
        });
        applyThemeToDocument(theme);
        setDirty(true);
    });

    // --- Dirty tracking ---
    projectionForm.addEventListener('input', () => setDirty(true));
    projectionForm.addEventListener('change', () => setDirty(true));

    // --- Language: save immediately on change ---
    if (languageSelect) {
        languageSelect.addEventListener('change', () => {
            mergeAndSave({ language: languageSelect.value });
            showStatus('Language saved.');
        });
    }

    // --- Save button ---
    saveButton.addEventListener('click', savePreferencesFromForm);
    projectionForm.addEventListener('submit', (e) => { e.preventDefault(); savePreferencesFromForm(); });

    // --- Reset: revert form to last saved state ---
    resetButton.addEventListener('click', () => {
        if (!currentPreferences) return;
        if (currentMenuPage === 'settings-appearence') {
            const themeCards = document.querySelectorAll('[data-set-theme]');
            const availableThemes = new Set(Array.from(themeCards).map((c) => c.dataset.setTheme));
            const theme = availableThemes.has(currentPreferences.theme) ? currentPreferences.theme : 'dark';
            selectedTheme = theme;
            themeCards.forEach((card) => {
                card.classList.toggle('outline-base-content!', card.dataset.setTheme === theme);
            });
            applyThemeToDocument(theme);
        } else {
            applyPreferencesToForm(currentPreferences);
        }
        setDirty(false);
    });

    // --- Restore Defaults: pull server defaults, save to localStorage ---
    restoreDefaultsButton.addEventListener('click', async () => {
        try {
            showStatus('Restoring defaults...');
            const res = await fetch('/api/preferences');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const serverDefaults = await res.json();
            const saved = mergeAndSave(
                currentMenuPage === 'settings-appearence'
                    ? { theme: serverDefaults.theme }
                    : serverDefaults
            );
            applyPreferencesToForm(saved);
            setDirty(false);
            showStatus('Defaults restored.');
        } catch (err) {
            console.error('Failed to restore defaults', err);
            showStatus('Failed to restore defaults.', true);
        }
    });

    // --- Close button ---
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
            // Navigate back: if embedded via iframe/include use event, if standalone page go back
            window.dispatchEvent(new CustomEvent('beameeSettingsClose'));
            if (window.history.length > 1) window.history.back();
        });
    }

    // --- OS dark mode watcher ---
    const osDark = window.matchMedia('(prefers-color-scheme: dark)');
    osDark.addEventListener('change', () => {
        if ((selectedTheme || currentPreferences?.theme) === 'system') {
            applyThemeToDocument('system');
        }
    });

    // --- Load preferences: localStorage first, fall back to /api/preferences ---
    try {
        let prefs = loadStoredPreferences();
        if (!prefs) {
            const res = await fetch('/api/preferences');
            if (res.ok) prefs = await res.json();
        }
        if (prefs) {
            applyPreferencesToForm(prefs);
        }
    } catch (err) {
        console.error('Failed to load preferences', err);
        showStatus('Failed to load preferences.', true);
    }

    updateActionBarVisibility();
}

document.addEventListener('DOMContentLoaded', init);
