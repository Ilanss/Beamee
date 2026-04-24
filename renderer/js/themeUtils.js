/**
 * Resolves the effective DaisyUI theme name to set on <html data-theme>.
 * The sentinel value "system" is resolved to "light" or "dark" based on the
 * OS preferred color scheme. All other values are passed through unchanged.
 *
 * @param {string} theme
 * @returns {string}
 */
export const resolveTheme = (theme) =>
  theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
