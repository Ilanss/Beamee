/**
 * Lightweight i18n module.
 *
 * Usage:
 *   import { loadLocale, t, applyTranslations } from './i18n.js';
 *
 *   // Initialise once with the resolved language code ('en' | 'fr')
 *   await loadLocale('fr');
 *
 *   // Translate a key (with optional {placeholder} substitution)
 *   t('library.title')                              // → 'Bibliothèque'
 *   t('settings.general.updates.available', { version: '2.0' }) // → 'Mise à jour v2.0 disponible.'
 *
 *   // Apply data-i18n translations to a DOM subtree
 *   applyTranslations(rootElement);
 */

const SUPPORTED_LANGS = ['en', 'fr'];
const DEFAULT_LANG = 'en';

/** @type {Record<string, string>} */
let catalogue = {};
let _lang = DEFAULT_LANG;

/**
 * Resolve a preference language value ('system' | 'en' | 'fr') + OS locale
 * into a concrete supported language code.
 *
 * @param {string} preference  - value from preferences.language
 * @param {string} osLocale    - value from Electron's app.getLocale()
 * @returns {'en'|'fr'}
 */
export const resolveLanguage = (preference, osLocale = '') => {
  if (preference && preference !== 'system' && SUPPORTED_LANGS.includes(preference)) {
    return preference;
  }

  // 'system' or unknown: match on the primary language tag of the OS locale.
  const tag = (typeof osLocale === 'string' ? osLocale : '').split(/[-_]/)[0].toLowerCase();
  return SUPPORTED_LANGS.includes(tag) ? tag : DEFAULT_LANG;
};

/**
 * Load a locale JSON file and activate it.
 * Locale files live at renderer/locales/<lang>.json, loaded via window.fs.
 *
 * @param {'en'|'fr'} lang
 */
export const loadLocale = (lang) => {
  const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;

  try {
    const url = new URL(`../locales/${safeLang}.json`, import.meta.url);
    const filePath = (() => {
      const pathname = decodeURIComponent(url.pathname);
      // On Windows the pathname starts with /C:/... — strip the leading slash.
      return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    })();

    const raw = window.fs.readFileSync(filePath, 'utf8');
    catalogue = JSON.parse(raw);
    _lang = safeLang;
  } catch (error) {
    console.warn(`[i18n] Failed to load locale "${safeLang}", falling back to built-in strings.`, error);
    catalogue = {};
    _lang = safeLang;
  }
};

/**
 * Return the active language code.
 * @returns {'en'|'fr'}
 */
export const currentLang = () => _lang;

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

/**
 * Walk a DOM subtree and apply translations based on data-i18n attributes.
 *
 * Supported attribute forms:
 *   data-i18n="key"                  → sets element.textContent
 *   data-i18n-placeholder="key"      → sets element.placeholder
 *   data-i18n-title="key"            → sets element.title
 *   data-i18n-aria-label="key"       → sets element.ariaLabel
 *
 * @param {Element} root
 */
export const applyTranslations = (root) => {
  if (!root) {
    return;
  }

  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) {
      el.textContent = t(key);
    }
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key) {
      el.placeholder = t(key);
    }
  });

  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (key) {
      el.title = t(key);
    }
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.dataset.i18nAriaLabel;
    if (key) {
      el.setAttribute('aria-label', t(key));
    }
  });

  // DaisyUI tooltip attribute
  root.querySelectorAll('[data-i18n-data-tip]').forEach((el) => {
    const key = el.dataset.i18nDataTip;
    if (key) {
      el.dataset.tip = t(key);
    }
  });
};
