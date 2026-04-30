/**
 * renderer/js/i18n.js — Electron wrapper around the shared i18n module.
 *
 * Re-exports everything from assets/js/i18n.js so all existing Electron
 * callers (router.js, renderer.js, preferences.js) continue to work with
 * no import path changes.
 *
 * The one platform-specific detail — how locale files are loaded — is passed
 * as a loaderFn at the call site in router.js:
 *   loadLocale(lang, (safeLang) => window.fs.readFileSync(filePath, 'utf8'))
 */

export { resolveLanguage, loadLocale, currentLang, t, applyTranslations } from '../../assets/js/i18n.js';

/**
 * Electron-specific locale loader.
 * Reads the locale JSON from the renderer/locales/ directory via window.fs.
 * Export this alongside loadLocale so every Electron caller has a single
 * import and can never accidentally omit the loaderFn argument.
 *
 * @param {string} safeLang - Resolved language code ('en' | 'fr')
 * @returns {string} Raw JSON text
 */
export function electronLocaleLoader(safeLang) {
    const url = new URL(`../locales/${safeLang}.json`, import.meta.url);
    const pathname = decodeURIComponent(url.pathname);
    const filePath = /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    return window.fs.readFileSync(filePath, 'utf8');
}
