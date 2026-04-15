const path = require('path');

const SCHEMA_VERSION = 1;
const SECTION_TYPES = [
    'verse',
    'chorus',
    'pre-chorus',
    'bridge',
    'intro',
    'outro',
    'tag',
    'other'
];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeId = (value, fallback = 'song') => {
    const normalized = String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || fallback;
};

const toStringArray = (value) => {
    if (!Array.isArray(value)) {
        if (typeof value === 'string' && value.trim()) {
            return [value.trim()];
        }

        return [];
    }

    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
};

const normalizeSectionType = (type) => {
    const value = typeof type === 'string' ? type.trim() : '';
    return SECTION_TYPES.includes(value) ? value : 'other';
};

const normalizeLines = (section) => {
    if (Array.isArray(section?.lines)) {
        return section.lines.map((line) => (typeof line === 'string' ? line : ''));
    }

    if (typeof section?.text === 'string') {
        return section.text.split(/\r?\n/);
    }

    return [];
};

const normalizeSections = (sections) => {
    if (!Array.isArray(sections)) {
        return [];
    }

    const usedIds = new Set();

    return sections
        .map((section, index) => {
            if (!isPlainObject(section) && typeof section !== 'string') {
                return null;
            }

            const raw = isPlainObject(section) ? section : { text: section };
            const baseId = normalizeId(raw.id || raw.title || raw.type || `section-${index + 1}`, `section-${index + 1}`);
            let id = baseId;
            let suffix = 2;

            while (usedIds.has(id)) {
                id = `${baseId}-${suffix++}`;
            }

            usedIds.add(id);

            return {
                id,
                type: normalizeSectionType(raw.type),
                title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined,
                lines: normalizeLines(raw),
            };
        })
        .filter(Boolean);
};

const normalizeCollections = (collections) => {
    if (!Array.isArray(collections)) {
        return [];
    }

    const seen = new Set();

    return collections
        .map((collection, index) => {
            if (!isPlainObject(collection) && typeof collection !== 'string') {
                return null;
            }

            const raw = isPlainObject(collection) ? collection : { name: collection };
            const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
            const collectionId = normalizeId(raw.collectionId || name || raw.id || `collection-${index + 1}`, `collection-${index + 1}`);
            const reference = typeof raw.reference === 'string' && raw.reference.trim() ? raw.reference.trim() : undefined;
            const number = Number.isInteger(raw.number) && raw.number > 0 ? raw.number : undefined;

            if (seen.has(collectionId)) {
                return null;
            }

            seen.add(collectionId);

            return {
                name: name || collectionId,
                collectionId,
                reference,
                number,
            };
        })
        .filter(Boolean);
};

const normalizeArrangement = (arrangement, sections) => {
    const sectionIds = new Set(sections.map((section) => section.id));

    if (Array.isArray(arrangement) && arrangement.length > 0) {
        return arrangement
            .map((item) => {
                if (typeof item === 'string') {
                    return { sectionId: item.trim() };
                }

                if (!isPlainObject(item) || typeof item.sectionId !== 'string') {
                    return null;
                }

                const sectionId = item.sectionId.trim();

                if (!sectionId) {
                    return null;
                }

                return {
                    sectionId,
                    label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : undefined,
                };
            })
            .filter((item) => item && sectionIds.has(item.sectionId));
    }

    return sections.map((section) => ({ sectionId: section.id }));
};

const normalizeSong = (song, options = {}) => {
    const raw = isPlainObject(song) ? song : {};
    const sourceName = options.sourcePath ? path.basename(options.sourcePath, path.extname(options.sourcePath)) : '';
    const rawId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    const id = normalizeId(rawId || sourceName || raw.name || options.fallbackId || 'song');
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
    const authors = toStringArray(raw.authors ?? raw.author ?? raw.artist);
    const collections = normalizeCollections(raw.collections ?? options.collections ?? []);

    const sections = normalizeSections(Array.isArray(raw.sections) ? raw.sections : []);
    const arrangement = normalizeArrangement(raw.arrangement, sections);

    const normalized = {
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        authors,
        collections,
        sections,
        arrangement,
    };

    if (typeof raw.createdAt === 'string' && raw.createdAt.trim()) {
        normalized.createdAt = raw.createdAt.trim();
    }

    if (typeof raw.updatedAt === 'string' && raw.updatedAt.trim()) {
        normalized.updatedAt = raw.updatedAt.trim();
    }

    if (typeof raw.language === 'string' && raw.language.trim()) {
        normalized.language = raw.language.trim();
    }

    normalized.tags = toStringArray(raw.tags);

    if (typeof raw.notes === 'string' && raw.notes.trim()) {
        normalized.notes = raw.notes.trim();
    }

    return normalized;
};

const migrateSongToV1 = (song, options = {}) => {
    const raw = isPlainObject(song) ? song : {};
    const legacySections = Array.isArray(raw.sections) && raw.sections.length > 0
        ? raw.sections
        : Array.isArray(raw.lyrics)
            ? raw.lyrics.map((section, index) => ({
                id: typeof section?.id === 'string' && section.id.trim()
                    ? section.id.trim()
                    : normalizeId(section?.type || `section-${index + 1}`, `section-${index + 1}`),
                type: section?.type,
                title: section?.title,
                text: section?.text,
                lines: section?.lines,
            }))
            : [];

    return normalizeSong({
        ...raw,
        sections: legacySections,
        arrangement: Array.isArray(raw.arrangement) && raw.arrangement.length > 0 ? raw.arrangement : legacySections.map((section) => ({ sectionId: section.id })),
    }, options);
};

const validateSong = (song) => {
    const errors = [];

    if (!isPlainObject(song)) {
        return ['Song must be an object'];
    }

    const allowedKeys = new Set([
        'schemaVersion',
        'id',
        'name',
        'authors',
        'collections',
        'sections',
        'arrangement',
        'createdAt',
        'updatedAt',
        'language',
        'tags',
        'notes',
    ]);

    Object.keys(song).forEach((key) => {
        if (!allowedKeys.has(key)) {
            errors.push(`Unknown top-level field: ${key}`);
        }
    });

    if (song.schemaVersion !== SCHEMA_VERSION) {
        errors.push('schemaVersion must be 1');
    }

    if (typeof song.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(song.id)) {
        errors.push('id must be a lower-case slug');
    }

    if (typeof song.name !== 'string' || !song.name.trim()) {
        errors.push('name is required');
    }

    if (!Array.isArray(song.authors) || song.authors.some((author) => typeof author !== 'string' || !author.trim())) {
        errors.push('authors must be an array of non-empty strings');
    }

    if (!Array.isArray(song.collections) || song.collections.some((collection) => !isPlainObject(collection))) {
        errors.push('collections must be an array of objects');
    } else {
        song.collections.forEach((collection, index) => {
            const allowedCollectionKeys = new Set(['name', 'collectionId', 'reference', 'number']);

            Object.keys(collection).forEach((key) => {
                if (!allowedCollectionKeys.has(key)) {
                    errors.push(`collections[${index}] has unknown field: ${key}`);
                }
            });

            if (typeof collection.name !== 'string' || !collection.name.trim()) {
                errors.push(`collections[${index}].name is required`);
            }

            if (typeof collection.collectionId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(collection.collectionId)) {
                errors.push(`collections[${index}].collectionId must be a lower-case slug`);
            }

            if (collection.reference !== undefined && (typeof collection.reference !== 'string' || !collection.reference.trim())) {
                errors.push(`collections[${index}].reference must be a non-empty string`);
            }

            if (collection.number !== undefined && (!Number.isInteger(collection.number) || collection.number < 1)) {
                errors.push(`collections[${index}].number must be a positive integer`);
            }
        });
    }

    if (!Array.isArray(song.sections) || song.sections.length === 0) {
        errors.push('sections must contain at least one section');
    }

    const sectionIds = new Set();

    if (Array.isArray(song.sections)) {
        song.sections.forEach((section, index) => {
            if (!isPlainObject(section)) {
                errors.push(`sections[${index}] must be an object`);
                return;
            }

            if (typeof section.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(section.id)) {
                errors.push(`sections[${index}].id must be a lower-case slug`);
            } else if (sectionIds.has(section.id)) {
                errors.push(`sections[${index}].id must be unique`);
            } else {
                sectionIds.add(section.id);
            }

            if (!SECTION_TYPES.includes(section.type)) {
                errors.push(`sections[${index}].type is invalid`);
            }

            if (!Array.isArray(section.lines) || section.lines.some((line) => typeof line !== 'string')) {
                errors.push(`sections[${index}].lines must be an array of strings`);
            }
        });
    }

    if (!Array.isArray(song.arrangement) || song.arrangement.length === 0) {
        errors.push('arrangement must contain at least one entry');
    } else {
        song.arrangement.forEach((item, index) => {
            if (!isPlainObject(item) || typeof item.sectionId !== 'string' || !item.sectionId.trim()) {
                errors.push(`arrangement[${index}].sectionId is required`);
                return;
            }

            if (!sectionIds.has(item.sectionId.trim())) {
                errors.push(`arrangement[${index}].sectionId must reference a section id`);
            }
        });
    }

    return errors;
};

module.exports = {
    SCHEMA_VERSION,
    SECTION_TYPES,
    normalizeId,
    normalizeSong,
    migrateSongToV1,
    validateSong,
};
