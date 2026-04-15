const fontSelect = document.getElementById('font-family');
const form = document.getElementById('preferences-form');
const statusElement = document.getElementById('preferences-status');

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
let availableFonts = fallbackFonts;

const showStatus = (message, isError = false) => {
  if (!statusElement) {
    return;
  }

  statusElement.textContent = message;
  statusElement.style.color = isError ? '#b91c1c' : '#166534';
};

const addFontOption = (font) => {
  if (!font) {
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
  fontSelect.innerHTML = '';
  fontFamilies.forEach(addFontOption);
};

const setInputValue = (id, value) => {
  const element = document.getElementById(id);

  if (element) {
    element.value = value;
  }
};

const readNumericValue = (id, fallback, parser = Number.parseFloat) => {
  const element = document.getElementById(id);

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

const applyPreferencesToForm = (preferences) => {
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
};

const loadPreferences = async () => {
  try {
    const preferences = await ipcRenderer.invoke('get-preferences');
    applyPreferencesToForm(preferences);
    showStatus('');
  } catch (error) {
    console.error('Failed to load preferences', error);
    showStatus('Failed to load preferences.', true);
  }
};

const readPreferencesFromForm = () => ({
  fontFamily: document.getElementById('font-family').value,
  fontSize: readNumericValue('font-size', currentPreferences?.fontSize, Number.parseInt),
  textColor: document.getElementById('text-color').value,
  backgroundColor: document.getElementById('background-color').value,
  lineHeight: readNumericValue('line-height', currentPreferences?.lineHeight),
  paddingTop: readNumericValue('padding-top', currentPreferences?.paddingTop, Number.parseInt),
  paddingBottom: readNumericValue('padding-bottom', currentPreferences?.paddingBottom, Number.parseInt),
  paddingLeft: readNumericValue('padding-left', currentPreferences?.paddingLeft, Number.parseInt),
  paddingRight: readNumericValue('padding-right', currentPreferences?.paddingRight, Number.parseInt),
});

getAvailableFonts().then((fontFamilies) => {
  availableFonts = fontFamilies;

  if (currentPreferences) {
    applyPreferencesToForm(currentPreferences);
  } else {
    populateFontOptions(availableFonts);
  }
});
loadPreferences();

ipcRenderer.on('preferences:changed', (preferences) => {
  applyPreferencesToForm(preferences);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    showStatus('Saving...');
    const preferences = await ipcRenderer.invoke('save-preferences', readPreferencesFromForm());
    applyPreferencesToForm(preferences);
    showStatus('Preferences saved.');
  } catch (error) {
    console.error('Failed to save preferences', error);
    showStatus('Failed to save preferences.', true);
  }
});

form.addEventListener('reset', (e) => {
  e.preventDefault();

  if (currentPreferences) {
    applyPreferencesToForm(currentPreferences);
  }
});

document.getElementById('restore-defaults').addEventListener('click', async () => {
  try {
    showStatus('Restoring defaults...');
    const preferences = await ipcRenderer.invoke('restore-preferences');
    applyPreferencesToForm(preferences);
    showStatus('Defaults restored.');
  } catch (error) {
    console.error('Failed to restore default preferences', error);
    showStatus('Failed to restore defaults.', true);
  }
});
