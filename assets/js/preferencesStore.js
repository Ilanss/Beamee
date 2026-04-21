const DEFAULT_PREFERENCES = Object.freeze({
    fontFamily: 'Arial',
    fontSize: 50,
    textColor: '#ffffff',
    backgroundColor: '#000000',
    lineHeight: 1,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 10,
    useArrangement: true,
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clampNumber = (value, fallback, min, max) => {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, min), max);
};

const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());

const isBoolean = (value) => typeof value === 'boolean';

const normalizePreferences = (preferences = {}) => {
    const source = isObject(preferences) ? preferences : {};

    // Only known keys are included — unknown keys from future or corrupted files are dropped.
    return {
        fontFamily: typeof source.fontFamily === 'string' && source.fontFamily.trim()
            ? source.fontFamily.trim()
            : DEFAULT_PREFERENCES.fontFamily,
        fontSize: clampNumber(source.fontSize, DEFAULT_PREFERENCES.fontSize, 10, 200),
        textColor: isHexColor(source.textColor)
            ? source.textColor.trim()
            : DEFAULT_PREFERENCES.textColor,
        backgroundColor: isHexColor(source.backgroundColor)
            ? source.backgroundColor.trim()
            : DEFAULT_PREFERENCES.backgroundColor,
        lineHeight: clampNumber(source.lineHeight, DEFAULT_PREFERENCES.lineHeight, 0.5, 3),
        paddingTop: clampNumber(source.paddingTop, DEFAULT_PREFERENCES.paddingTop, 0, 200),
        paddingBottom: clampNumber(source.paddingBottom, DEFAULT_PREFERENCES.paddingBottom, 0, 200),
        paddingLeft: clampNumber(source.paddingLeft, DEFAULT_PREFERENCES.paddingLeft, 0, 200),
        paddingRight: clampNumber(source.paddingRight, DEFAULT_PREFERENCES.paddingRight, 0, 200),
        useArrangement: isBoolean(source.useArrangement) ? source.useArrangement : DEFAULT_PREFERENCES.useArrangement,
    };
};

const mergePreferences = (currentPreferences, updates) => {
    return normalizePreferences({
        ...normalizePreferences(currentPreferences),
        ...(isObject(updates) ? updates : {}),
    });
};

module.exports = {
    DEFAULT_PREFERENCES,
    normalizePreferences,
    mergePreferences,
};
