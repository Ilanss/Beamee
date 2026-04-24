import { resolveTheme } from './themeUtils.js';

let rootElement = null;
let fontSelect = null;
let form = null;
let saveButton = null;
let statusElement = null;
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
const cleanupTasks = [];
let mountContext = null;

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

const showStatus = (message, isError = false) => {
  if (!statusElement) {
    return;
  }

  statusElement.textContent = message;
  statusElement.classList.toggle('text-error', isError);
  statusElement.classList.toggle('text-success', !isError);
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
    backgroundImageNameEl.textContent = hasImage ? backgroundImage : 'No image set';
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
        showStatus('Opening file picker...');
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
        showStatus('Background image saved.');
      } catch (error) {
        console.error('Failed to set background image', error);
        if (isMountCurrent()) {
          showStatus('Failed to save background image.', true);
        }
      }
    });
  }

  if (removeBackgroundImageButton) {
    on(removeBackgroundImageButton, 'click', async () => {
      try {
        showStatus('Removing image...');
        const preferences = await ipcRenderer.invoke('preferences:remove-background-image');

        if (isMountCurrent()) {
          applyPreferencesToForm(preferences);
          showStatus('Background image removed.');
        }
      } catch (error) {
        console.error('Failed to remove background image', error);
        if (isMountCurrent()) {
          showStatus('Failed to remove background image.', true);
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

const readPreferencesFromForm = () => ({
  fontFamily: fontSelect?.value || currentPreferences?.fontFamily,
  fontSize: readNumericValue('font-size', currentPreferences?.fontSize, Number.parseInt),
  textColor: getField('text-color')?.value,
  backgroundColor: getField('background-color')?.value,
  lineHeight: readNumericValue('line-height', currentPreferences?.lineHeight),
  paddingTop: readNumericValue('padding-top', currentPreferences?.paddingTop, Number.parseInt),
  paddingBottom: readNumericValue('padding-bottom', currentPreferences?.paddingBottom, Number.parseInt),
  paddingLeft: readNumericValue('padding-left', currentPreferences?.paddingLeft, Number.parseInt),
  paddingRight: readNumericValue('padding-right', currentPreferences?.paddingRight, Number.parseInt),
  theme: selectedTheme || currentPreferences?.theme || 'light',
});

const savePreferencesFromForm = async () => {
  try {
    showStatus('Saving...');
    const preferences = await ipcRenderer.invoke('save-preferences', readPreferencesFromForm());

    if (isMountCurrent()) {
      try {
        applyPreferencesToForm(preferences);
      } catch (refreshError) {
        console.error('Saved preferences, but failed to refresh the form', refreshError);
      }
    }

    showStatus('Preferences saved.');
  } catch (error) {
    console.error('Failed to save preferences', error);
    showStatus('Failed to save preferences.', true);
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
  form = rootElement.querySelector('#preferences-form');
  saveButton = rootElement.querySelector('#save-preferences');
  statusElement = rootElement.querySelector('#preferences-status');

  on(rootElement.querySelector('.menu'), 'click', (e) => {
    const item = e.target.closest('li[data-settings-id]');

    if (!item) {
      return;
    }

    const menuPage = item.dataset.settingsId;

    rootElement.querySelectorAll('li a.menu-active').forEach((anchor) => {
      anchor.classList.remove('menu-active');
    });

    item.querySelector('a')?.classList.add('menu-active');
    loadMenu(menuPage);
  });

  colorFieldIds.forEach(bindColorField);
  bindBackgroundImageField();

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
  });

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

  on(form, 'submit', async (e) => {
    e.preventDefault();

    await savePreferencesFromForm();
  });

  on(form, 'reset', (e) => {
    e.preventDefault();

    if (currentPreferences) {
      applyPreferencesToForm(currentPreferences);
    }
  });

  on(rootElement.querySelector('#btn-github'), 'click', () => {
    ipcRenderer.invoke('open-external-url', 'https://github.com/Ilanss/Beamee');
  });

  on(rootElement.querySelector('#btn-kofi'), 'click', () => {
    ipcRenderer.invoke('open-external-url', 'https://ko-fi.com/ilans_');
  });

  on(rootElement.querySelector('#restore-defaults'), 'click', async () => {
    try {
      showStatus('Restoring defaults...');
      const preferences = await ipcRenderer.invoke('restore-preferences');
      if (isMountCurrent()) {
        applyPreferencesToForm(preferences);
      }
      showStatus('Defaults restored.');
    } catch (error) {
      console.error('Failed to restore default preferences', error);
      showStatus('Failed to restore defaults.', true);
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
    showStatus('');
  } catch (error) {
    if (!isMountCurrent()) {
      return;
    }

    console.error('Failed to load preferences', error);
    showStatus('Failed to load preferences.', true);
  }
}

export async function unmount() {
  resetCleanup();
  mounted = false;
  rootElement = null;
  fontSelect = null;
  form = null;
  saveButton = null;
  statusElement = null;
  backgroundImageButton = null;
  removeBackgroundImageButton = null;
  backgroundImageNameEl = null;
  mountContext = null;
  selectedTheme = null;
}
