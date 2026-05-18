/**
 * assets/js/i18n.js — shared i18n module
 *
 * Used by both:
 *   - renderer/js/renderer.js  (Electron) — via renderer/js/i18n.js re-export
 *   - web/public/js/control.js (Docker / browser) — via /assets/js/i18n.js
 *
 * Platform difference is injected through the `loaderFn` parameter of
 * `loadLocale`:
 *   Electron: (filePath) => window.fs.readFileSync(filePath, 'utf8')
 *   Web:      async (url) => fetch(url).then(r => r.text())
 *
 * Everything else — t(), applyTranslations(), resolveLanguage() — is pure
 * and platform-independent.
 */

const SUPPORTED_LANGS = ['en', 'fr'];
const DEFAULT_LANG = 'en';

/** @type {Record<string, string>} */
let catalogue = {};
let _lang = DEFAULT_LANG;

// ---------------------------------------------------------------------------
// resolveLanguage
// ---------------------------------------------------------------------------

/**
 * Resolve a preference language value ('system' | 'en' | 'fr') + OS/browser
 * locale string into a concrete supported language code.
 *
 * Works for both Electron (app.getLocale() format) and browser
 * (navigator.language format): both produce BCP-47 tags like 'fr-CA'.
 *
 * @param {string} preference  - value from preferences.language
 * @param {string} [osLocale]  - OS locale from Electron or navigator.language
 * @returns {'en'|'fr'}
 */
export const resolveLanguage = (preference, osLocale = '') => {
    if (preference && preference !== 'system' && SUPPORTED_LANGS.includes(preference)) {
        return preference;
    }

    // 'system' or unknown: match on the primary language tag.
    const tag = (typeof osLocale === 'string' ? osLocale : '').split(/[-_]/)[0].toLowerCase();
    return SUPPORTED_LANGS.includes(tag) ? tag : DEFAULT_LANG;
};

// ---------------------------------------------------------------------------
// loadLocale
// ---------------------------------------------------------------------------

/**
 * Load a locale file and activate it.
 *
 * @param {'en'|'fr'} lang
 * @param {Function}  loaderFn  - Platform-specific loader.
 *   Electron: (filePath: string) => string          (sync, window.fs)
 *   Web:      async (url: string) => Promise<string> (fetch)
 *   The function receives the resolved path/URL and must return the raw JSON
 *   text (or a Promise that resolves to it).
 */
export const loadLocale = async (lang, loaderFn) => {
    const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;

    try {
        const raw = await loaderFn(safeLang);
        catalogue = JSON.parse(raw);
        _lang = safeLang;
    } catch (error) {
        console.warn(`[i18n] Failed to load locale "${safeLang}", falling back to built-in strings.`, error);
        catalogue = {};
        _lang = safeLang;
    }
};

// ---------------------------------------------------------------------------
// currentLang
// ---------------------------------------------------------------------------

/**
 * Return the active language code.
 * @returns {'en'|'fr'}
 */
export const currentLang = () => _lang;

// ---------------------------------------------------------------------------
// t — translate
// ---------------------------------------------------------------------------

/**
 * Translate a key, substituting {placeholder} tokens.
 *
 * @param {string} key
 * @param {Record<string, string|number>} [replacements]
 * @returns {string}
 */
export const t = (key, replacements) => {
    let value = catalogue[key];

    if (typeof value !== 'string') {
        // Fall back to the key itself so the UI still shows something legible.
        return key;
    }

    if (replacements) {
        for (const [token, replacement] of Object.entries(replacements)) {
            value = value.replaceAll(`{${token}}`, String(replacement));
        }
    }

    return value;
};

// ---------------------------------------------------------------------------
// applyTranslations — walk DOM and apply data-i18n* attributes
// ---------------------------------------------------------------------------

/**
 * Walk a DOM subtree and apply translations based on data-i18n attributes.
 *
 * Supported attribute forms:
 *   data-i18n="key"               → sets element.textContent
 *   data-i18n-placeholder="key"   → sets element.placeholder
 *   data-i18n-title="key"         → sets element.title
 *   data-i18n-aria-label="key"    → sets element.setAttribute('aria-label')
 *   data-i18n-data-tip="key"      → sets element.dataset.tip (DaisyUI tooltip)
 *
 * @param {Element} root
 */
export const applyTranslations = (root) => {
    if (!root) return;

    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.dataset.i18n;
        if (key) el.textContent = t(key);
    });

    // data-i18n-html: like data-i18n but sets innerHTML, allowing <br> and
    // light formatting in locale strings. Only use for trusted locale values.
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.dataset.i18nHtml;
        if (key) el.innerHTML = t(key);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.dataset.i18nPlaceholder;
        if (key) el.placeholder = t(key);
    });

    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.dataset.i18nTitle;
        if (key) el.title = t(key);
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
        const key = el.dataset.i18nAriaLabel;
        if (key) el.setAttribute('aria-label', t(key));
    });

    // DaisyUI tooltip attribute
    root.querySelectorAll('[data-i18n-data-tip]').forEach((el) => {
        const key = el.dataset.i18nDataTip;
        if (key) el.dataset.tip = t(key);
    });
};
