import { resolveTheme } from './themeUtils.js';
import { loadLocale, resolveLanguage, applyTranslations, t } from './i18n.js';

let rootElement = null;
let fontSelect = null;
let projectionForm = null;
let saveButton = null;
let restoreDefaultsButton = null;
let resetButton = null;
let backgroundImageButton = null;
let removeBackgroundImageButton = null;
let backgroundImageNameEl = null;
let mounted = false;
const colorFieldIds = ['text-color', 'background-color'];

const fallbackFonts = [
  'Arial',
  'Arial Black',
  'Courier New',
  'Georgia',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'MS Sans Serif',
  'MS Serif',
];

let currentPreferences = null;
let selectedTheme = null;
let availableFonts = fallbackFonts;
let currentMenuPage = 'settings-projection';
let isDirty = false;
const cleanupTasks = [];
let mountContext = null;
let languageSelect = null;

// Pages that have saveable settings and should show the action buttons.
const PAGES_WITH_ACTIONS = new Set(['settings-projection', 'settings-appearence']);

const on = (target, eventName, handler, options) => {
  target?.addEventListener(eventName, handler, options);

  cleanupTasks.push(() => {
    target?.removeEventListener(eventName, handler, options);
  });
};

function loadMenu(menuPage) {
  if (!menuPage) {
    return;
  }

  document.querySelectorAll('.menu-page').forEach((anchor) => {
    anchor.hidden = true;
  });

  document.querySelector("#" + menuPage).hidden = false;
  currentMenuPage = menuPage;
  updateActionBarVisibility();
}

const onIpc = (channel, handler) => {
  ipcRenderer.on(channel, handler);
  cleanupTasks.push(() => {
    ipcRenderer.off(channel, handler);
  });
};

const bindSelectAllShortcut = (input) => {
  if (!input) {
    return;
  }

  on(input, 'keydown', (event) => {
    if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a')) {
      return;
    }

    event.preventDefault();
    input.select();
  });
};

const resetCleanup = () => {
  while (cleanupTasks.length) {
    const cleanup = cleanupTasks.pop();

    try {
      cleanup?.();
    } catch (error) {
      console.warn('Failed to clean up preferences view listener', error);
    }
  }
};

const isMountCurrent = () => mounted && (!mountContext || typeof mountContext.isCurrent !== 'function' || mountContext.isCurrent());

// Resolves the correct status element for the currently active page.
const getStatusElement = () => {
  const idMap = {
    'settings-projection': 'status-projection',
    'settings-appearence': 'status-appearence',
    'settings-general': 'status-general',
  };
  const id = idMap[currentMenuPage];
  return id ? rootElement?.querySelector(`#${id}`) : null;
};

const showStatus = (message, isError = false) => {
  const el = getStatusElement();

  if (!el) {
    return;
  }

  el.textContent = message;
  el.classList.toggle('text-error', isError);
  el.classList.toggle('text-success', !isError);
};

// Marks the active page as having unsaved changes and updates the Save button style.
const setDirty = (value) => {
  isDirty = value;

  if (!saveButton) {
    return;
  }

  saveButton.classList.toggle('btn-primary', value);
  saveButton.classList.toggle('btn-disabled', !value);
};

// Shows or hides the Save and Restore Defaults buttons depending on whether the
// active page has saveable settings. Also clears any pending dirty state since
// the user navigated away from the previous page.
const updateActionBarVisibility = () => {
  const show = PAGES_WITH_ACTIONS.has(currentMenuPage);

  if (saveButton) {
    saveButton.hidden = !show;
  }

  if (restoreDefaultsButton) {
    restoreDefaultsButton.hidden = !show;
  }

  if (resetButton) {
    resetButton.hidden = !show;
  }

  // Switching pages discards any unsaved indicator from the previous page.
  setDirty(false);
};

const applyThemeToDocument = (theme) => {
  if (typeof theme === 'string' && theme) {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme));
  }
};

const getField = (id) => rootElement?.querySelector(`#${id}`);

const getColorTrigger = (id) => rootElement?.querySelector(`[data-color-trigger="${id}"]`);

const getColorSwatch = (id) => rootElement?.querySelector(`[data-color-swatch="${id}"]`);

const getColorValue = (id) => rootElement?.querySelector(`[data-color-value="${id}"]`);

const syncColorFieldPreview = (id) => {
  const input = getField(id);
  const swatch = getColorSwatch(id);
  const value = getColorValue(id);

  if (!input) {
    return;
  }

  const color = typeof input.value === 'string' && input.value ? input.value : '#000000';

  if (swatch) {
    swatch.style.backgroundColor = color;
  }

  if (value) {
    value.textContent = color.toUpperCase();
  }
};

const bindColorField = (id) => {
  const input = getField(id);
  const trigger = getColorTrigger(id);

  if (!input || !trigger) {
    return;
  }

  on(trigger, 'click', () => {
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }

    input.click();
  });

  on(input, 'input', () => {
    syncColorFieldPreview(id);
  });

  on(input, 'change', () => {
    syncColorFieldPreview(id);
  });

  syncColorFieldPreview(id);
};

const addFontOption = (font) => {
  if (!font || !fontSelect) {
    return;
  }

  const exists = Array.from(fontSelect.options).some((option) => option.value === font);
  if (exists) {
    return;
  }

  const option = document.createElement('option');
  option.value = font;
  option.text = font;
  fontSelect.add(option);
};

const populateFontOptions = (fontFamilies) => {
  if (!fontSelect) {
    return;
  }

  fontSelect.innerHTML = '';
  fontFamilies.forEach(addFontOption);
};

const setInputValue = (id, value) => {
  const element = getField(id);

  if (element) {
    element.value = value;
  }

  if (colorFieldIds.includes(id)) {
    syncColorFieldPreview(id);
  }
};

const readNumericValue = (id, fallback, parser = Number.parseFloat) => {
  const element = getField(id);

  if (!element) {
    return fallback;
  }

  const parsed = parser(element.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getAvailableFonts = async () => {
  if (typeof window.queryLocalFonts !== 'function') {
    return fallbackFonts;
  }

  try {
    const localFonts = await window.queryLocalFonts();
    const fontFamilies = [...new Set(localFonts.map((font) => font.family).filter(Boolean))];
    return fontFamilies.length ? fontFamilies.sort() : fallbackFonts;
  } catch (error) {
    console.warn('Falling back to the built-in font list', error);
    return fallbackFonts;
  }
};

const applyBackgroundImageToForm = (backgroundImage) => {
  const hasImage = typeof backgroundImage === 'string' && backgroundImage.trim();

  if (backgroundImageNameEl) {
    backgroundImageNameEl.textContent = hasImage ? backgroundImage : t('settings.projection.backgroundImage.noImage');
    backgroundImageNameEl.classList.toggle('opacity-50', !hasImage);
  }

  if (removeBackgroundImageButton) {
    removeBackgroundImageButton.hidden = !hasImage;
  }
};

const bindBackgroundImageField = () => {
  backgroundImageButton = rootElement?.querySelector('#background-image');
  removeBackgroundImageButton = rootElement?.querySelector('#remove-background-image');
  backgroundImageNameEl = rootElement?.querySelector('#background-image-name');

  if (backgroundImageButton) {
    on(backgroundImageButton, 'click', async () => {
      try {
        showStatus(t('settings.projection.backgroundImage.opening'));
        // Returns null if the user cancelled, or the updated preferences object.
        const preferences = await ipcRenderer.invoke('preferences:pick-background-image');

        if (!isMountCurrent()) {
          return;
        }

        if (preferences === null) {
          showStatus('');
          return;
        }

        applyPreferencesToForm(preferences);
        showStatus(t('settings.projection.backgroundImage.saved'));
      } catch (error) {
        console.error('Failed to set background image', error);
        if (isMountCurrent()) {
          showStatus(t('settings.projection.backgroundImage.saveFailed'), true);
        }
      }
    });
  }

  if (removeBackgroundImageButton) {
    on(removeBackgroundImageButton, 'click', async () => {
      try {
        showStatus(t('settings.projection.backgroundImage.opening'));
        const preferences = await ipcRenderer.invoke('preferences:remove-background-image');

        if (isMountCurrent()) {
          applyPreferencesToForm(preferences);
          showStatus(t('settings.projection.backgroundImage.removed'));
        }
      } catch (error) {
        console.error('Failed to remove background image', error);
        if (isMountCurrent()) {
          showStatus(t('settings.projection.backgroundImage.removeFailed'), true);
        }
      }
    });
  }
};

const applyPreferencesToForm = (preferences) => {
  if (!fontSelect || !preferences) {
    return false;
  }

  currentPreferences = preferences;

  if (languageSelect && preferences.language) {
    languageSelect.value = preferences.language;
  }

  populateFontOptions(availableFonts);
  addFontOption(preferences.fontFamily);

  fontSelect.value = preferences.fontFamily;
  setInputValue('font-size', preferences.fontSize);
  setInputValue('text-color', preferences.textColor);
  setInputValue('background-color', preferences.backgroundColor);
  setInputValue('line-height', preferences.lineHeight);
  setInputValue('padding-top', preferences.paddingTop);
  setInputValue('padding-bottom', preferences.paddingBottom);
  setInputValue('padding-left', preferences.paddingLeft);
  setInputValue('padding-right', preferences.paddingRight);

  applyBackgroundImageToForm(preferences.backgroundImage ?? null);

  const themeCards = rootElement?.querySelectorAll('[data-set-theme]') ?? [];
  const availableThemes = new Set(Array.from(themeCards).map((c) => c.dataset.setTheme));
  const theme = availableThemes.has(preferences.theme) ? preferences.theme : 'light';

  selectedTheme = theme;
  themeCards.forEach((card) => {
    card.classList.toggle('outline-base-content!', card.dataset.setTheme === theme);
  });
  applyThemeToDocument(theme);

  return true;
};

// Reads only the Projection page fields.
const readProjectionPreferences = () => ({
  fontFamily: fontSelect?.value || currentPreferences?.fontFamily,
  fontSize: readNumericValue('font-size', currentPreferences?.fontSize, Number.parseInt),
  textColor: getField('text-color')?.value,
  backgroundColor: getField('background-color')?.value,
  lineHeight: readNumericValue('line-height', currentPreferences?.lineHeight),
  paddingTop: readNumericValue('padding-top', currentPreferences?.paddingTop, Number.parseInt),
  paddingBottom: readNumericValue('padding-bottom', currentPreferences?.paddingBottom, Number.parseInt),
  paddingLeft: readNumericValue('padding-left', currentPreferences?.paddingLeft, Number.parseInt),
  paddingRight: readNumericValue('padding-right', currentPreferences?.paddingRight, Number.parseInt),
});

// Reads only the Appearance page fields.
const readAppearencePreferences = () => ({
  theme: selectedTheme || currentPreferences?.theme || 'light',
  language: languageSelect?.value || currentPreferences?.language || 'system',
});

// Saves only the settings belonging to the currently active page.
const savePreferencesFromForm = async () => {
  try {
    showStatus(t('settings.projection.saving'));

    const payload = currentMenuPage === 'settings-appearence'
      ? readAppearencePreferences()
      : readProjectionPreferences();

    const preferences = await ipcRenderer.invoke('save-preferences', payload);

    if (isMountCurrent()) {
      try {
        applyPreferencesToForm(preferences);
        setDirty(false);
      } catch (refreshError) {
        console.error('Saved preferences, but failed to refresh the form', refreshError);
      }
    }

    showStatus(t('settings.projection.saved'));
  } catch (error) {
    console.error('Failed to save preferences', error);
    showStatus(t('settings.projection.saveFailed'), true);
  }
};

export async function mount(root, context = {}) {
  if (mounted) {
    return;
  }

  mounted = true;
  mountContext = context;
  rootElement = root;
  fontSelect = rootElement.querySelector('#font-family');
  projectionForm = rootElement.querySelector('#form-projection');
  saveButton = rootElement.querySelector('#save-preferences');
  restoreDefaultsButton = rootElement.querySelector('#restore-defaults');
  resetButton = rootElement.querySelector('#reset-preferences');
  languageSelect = rootElement.querySelector('#app-language');

  // Apply translations to the static HTML immediately so the UI is in the
  // correct language even before preferences are loaded from disk.
  applyTranslations(rootElement);

  on(rootElement.querySelector('.menu'), 'click', (e) => {
    const item = e.target.closest('li[data-settings-id]');

    if (!item) {
      return;
    }

    const menuPage = item.dataset.settingsId;

    // Already on this page — nothing to do.
    if (menuPage === currentMenuPage) {
      return;
    }

    if (isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Leave without saving?');

      if (!confirmed) {
        return;
      }

      // Revert the current page's form so it is clean when the user returns.
      if (currentPreferences) {
        applyPreferencesToForm(currentPreferences);
      }
    }

    rootElement.querySelectorAll('li a.menu-active').forEach((anchor) => {
      anchor.classList.remove('menu-active');
    });

    item.querySelector('a')?.classList.add('menu-active');
    loadMenu(menuPage);
  });

  colorFieldIds.forEach(bindColorField);
  bindBackgroundImageField();

  // Language select — save immediately on change and re-navigate to re-render
  // the entire view in the new language (mirrors how theme switching works).
  if (languageSelect) {
    on(languageSelect, 'change', async () => {
      const newLang = languageSelect.value;
      try {
        const updated = await ipcRenderer.invoke('save-preferences', {
          ...readAppearencePreferences(),
          language: newLang,
        });

        if (!isMountCurrent()) {
          return;
        }

        // Reload the locale catalogue then re-apply all translations in the
        // live DOM immediately — no navigation needed since the module is
        // already mounted and applyTranslations walks the whole subtree.
        const resolvedLang = resolveLanguage(newLang, updated?.osLocale ?? '');
        loadLocale(resolvedLang);
        applyTranslations(rootElement);

        // Re-apply background image text which uses t() at runtime.
        applyBackgroundImageToForm(currentPreferences?.backgroundImage ?? null);
      } catch (error) {
        console.error('Failed to save language preference', error);
      }
    });
  }

  on(rootElement.querySelector('#settings-appearence'), 'click', (e) => {
    const card = e.target.closest('[data-set-theme]');

    if (!card) {
      return;
    }

    const theme = card.dataset.setTheme;
    if (!theme) {
      return;
    }

    selectedTheme = theme;

    rootElement.querySelectorAll('[data-set-theme]').forEach((c) => {
      c.classList.toggle('outline-base-content!', c === card);
    });

    applyThemeToDocument(theme);
    setDirty(true);
  });

  // Dirty tracking for Projection form fields.
  on(projectionForm, 'input', () => setDirty(true));
  on(projectionForm, 'change', () => setDirty(true));

  Array.from(rootElement.querySelectorAll('input, textarea')).forEach((input) => {
    if (!(input instanceof HTMLInputElement)) {
      bindSelectAllShortcut(input);
      return;
    }

    if (['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'reset', 'submit'].includes(input.type)) {
      return;
    }

    bindSelectAllShortcut(input);
  });

  onIpc('preferences:changed', (preferences) => {
    applyPreferencesToForm(preferences);
  });

  // --- Updater UI ---
  const appVersionEl = rootElement.querySelector('#app-version');
  const updateStatusEl = rootElement.querySelector('#update-status');
  const checkForUpdateBtn = rootElement.querySelector('#check-for-update');
  const downloadUpdateBtn = rootElement.querySelector('#download-update');
  const installUpdateBtn = rootElement.querySelector('#install-update');
  const updateProgressEl = rootElement.querySelector('#update-progress');

  if (appVersionEl) {
    ipcRenderer.invoke('app:get-version').then((version) => {
      if (isMountCurrent()) appVersionEl.textContent = version;
    }).catch(() => {});
  }

  const setUpdateStatus = (text) => {
    if (updateStatusEl) updateStatusEl.textContent = text;
  };

  const setUpdateControls = ({ downloading = false, available = false, downloaded = false } = {}) => {
    if (checkForUpdateBtn) checkForUpdateBtn.disabled = downloading;
    if (downloadUpdateBtn) downloadUpdateBtn.hidden = !available;
    if (installUpdateBtn) installUpdateBtn.hidden = !downloaded;
    if (updateProgressEl) updateProgressEl.hidden = !downloading;
  };

  onIpc('updater:status', (_, { event, version, percent, message } = {}) => {
    switch (event) {
      case 'checking':
        setUpdateStatus(t('settings.general.updates.checking'));
        setUpdateControls({ downloading: true });
        break;
      case 'not-available':
        setUpdateStatus(t('settings.general.updates.upToDate'));
        setUpdateControls();
        break;
      case 'available':
        setUpdateStatus(t('settings.general.updates.available', { version }));
        setUpdateControls({ available: true });
        break;
      case 'progress':
        setUpdateStatus(t('settings.general.updates.downloading', { percent }));
        setUpdateControls({ downloading: true });
        if (updateProgressEl) updateProgressEl.value = percent ?? 0;
        break;
      case 'downloaded':
        setUpdateStatus(t('settings.general.updates.ready'));
        setUpdateControls({ downloaded: true });
        break;
      case 'error':
        setUpdateStatus(t('settings.general.updates.error') + (message ? ' ' + message : ''));
        setUpdateControls();
        break;
    }
  });

  on(checkForUpdateBtn, 'click', () => {
    ipcRenderer.invoke('updater:check');
  });

  on(downloadUpdateBtn, 'click', () => {
    ipcRenderer.invoke('updater:download');
  });

  on(installUpdateBtn, 'click', () => {
    ipcRenderer.invoke('updater:install');
  });

  // When "Check for update..." is clicked in the File menu, navigate to the
  // General tab and trigger the check so the user sees feedback in the UI.
  onIpc('updater:trigger-check', () => {
    // Activate the General nav item visually
    rootElement.querySelectorAll('li a.menu-active').forEach((a) => a.classList.remove('menu-active'));
    rootElement.querySelector('li[data-settings-id="settings-general"] a')?.classList.add('menu-active');
    loadMenu('settings-general');
    ipcRenderer.invoke('updater:check');
  });
  // --- End updater UI ---

  const osDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const onOsSchemeChange = () => {
    const theme = selectedTheme || currentPreferences?.theme;
    if (theme === 'system') {
      applyThemeToDocument('system');
    }
  };
  osDarkMedia.addEventListener('change', onOsSchemeChange);
  cleanupTasks.push(() => osDarkMedia.removeEventListener('change', onOsSchemeChange));

  on(saveButton, 'click', async () => {
    await savePreferencesFromForm();
  });

  on(projectionForm, 'submit', async (e) => {
    e.preventDefault();
    await savePreferencesFromForm();
  });

  on(resetButton, 'click', () => {
    if (!currentPreferences) {
      return;
    }

    if (currentMenuPage === 'settings-appearence') {
      // Revert theme selection to last saved state without touching the form.
      const themeCards = rootElement?.querySelectorAll('[data-set-theme]') ?? [];
      const availableThemes = new Set(Array.from(themeCards).map((c) => c.dataset.setTheme));
      const theme = availableThemes.has(currentPreferences.theme) ? currentPreferences.theme : 'light';
      selectedTheme = theme;
      themeCards.forEach((card) => {
        card.classList.toggle('outline-base-content!', card.dataset.setTheme === theme);
      });
      applyThemeToDocument(theme);
    } else {
      // Revert all Projection form fields to last saved state.
      applyPreferencesToForm(currentPreferences);
    }

    setDirty(false);
  });

  on(rootElement.querySelector('#btn-github'), 'click', () => {
    ipcRenderer.invoke('open-external-url', 'https://github.com/Ilanss/Beamee');
  });

  on(rootElement.querySelector('#btn-kofi'), 'click', () => {
    ipcRenderer.invoke('open-external-url', 'https://ko-fi.com/ilans_');
  });

  on(restoreDefaultsButton, 'click', async () => {
    try {
      showStatus(t('settings.about.restoring'));
      let preferences;

      if (currentMenuPage === 'settings-appearence') {
        // Restore only the theme setting.
        preferences = await ipcRenderer.invoke('save-preferences', { theme: 'system' });
      } else {
        // Restore all Projection settings, including background image cleanup.
        preferences = await ipcRenderer.invoke('restore-projection-defaults');
      }

      if (isMountCurrent()) {
        applyPreferencesToForm(preferences);
        setDirty(false);
      }

      showStatus(t('settings.about.restored'));
    } catch (error) {
      console.error('Failed to restore default preferences', error);
      showStatus(t('settings.about.restoreFailed'), true);
    }
  });

  try {
    const fontFamilies = await getAvailableFonts();

    if (!isMountCurrent()) {
      return;
    }

    availableFonts = fontFamilies;

    const preferences = await ipcRenderer.invoke('get-preferences');

    if (!isMountCurrent()) {
      return;
    }

    applyPreferencesToForm(preferences);
    // Re-apply translations after preferences are loaded so any keys that
    // depend on the loaded language are up to date.
    applyTranslations(rootElement);
    showStatus('');
  } catch (error) {
    if (!isMountCurrent()) {
      return;
    }

    console.error('Failed to load preferences', error);
    showStatus(t('settings.projection.loadFailed'), true);
  }

  // Set initial action bar state based on the default active page.
  updateActionBarVisibility();
}

// Called by the router before navigating away. Returns false to cancel navigation.
export function canUnmount() {
  if (!isDirty) {
    return true;
  }

  const confirmed = window.confirm('You have unsaved changes. Leave without saving?');

  if (confirmed && currentPreferences) {
    // Revert in-memory state so the form is clean if settings is re-opened.
    applyPreferencesToForm(currentPreferences);
    setDirty(false);
  }

  return confirmed;
}

export async function unmount() {
  resetCleanup();
  mounted = false;
  rootElement = null;
  fontSelect = null;
  projectionForm = null;
  saveButton = null;
  restoreDefaultsButton = null;
  resetButton = null;
  backgroundImageButton = null;
  removeBackgroundImageButton = null;
  backgroundImageNameEl = null;
  mountContext = null;
  selectedTheme = null;
  currentMenuPage = 'settings-projection';
  isDirty = false;
  languageSelect = null;
}
