'use strict';

/**
 * ChordPro importer for Beamee.
 *
 * Supported input:
 *   - Common extensions: .cho, .crd, .chopro, .chord, .pro
 *   - ChordPro directives: {title}, {artist}, {composer}, {lyricist},
 *     {subtitle}, {key}, {capo}, {tempo}, {tag}, {comment}, section
 *     environments (start_of_verse/chorus/bridge/pre-chorus/intro/outro/
 *     tag/other and their short forms), and the bare {chorus} repeat.
 *   - Inline chord markers [Am], [C/G], etc. are stripped from lyric lines.
 *   - Multi-song files separated by {new_song} are split into separate songs.
 *   - Files with no section directives are split into paragraphs on blank
 *     lines; each becomes a 'verse' section (or 'chorus' when preceded by
 *     a {comment: Chorus}-style hint).
 *
 * Output: an array of raw song objects ready to pass to
 *   songSchema.normalizeSong() + songSchema.validateSong().
 *
 * No npm dependencies. No chord-related data is carried over (this is a
 * lyrics-only application).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map from ChordPro environment name → Beamee section type. */
const ENV_TYPE_MAP = {
    verse: 'verse',
    v: 'verse',
    chorus: 'chorus',
    c: 'chorus',
    bridge: 'bridge',
    b: 'bridge',
    'pre-chorus': 'pre-chorus',
    prechorus: 'pre-chorus',
    pc: 'pre-chorus',
    intro: 'intro',
    outro: 'outro',
    tag: 'tag',
    // tab, grid, abc, ly, svg, textblock → will be ignored (no lyric content)
};

/** Environment names that contain no singable lyrics and should be skipped. */
const IGNORED_ENVS = new Set(['tab', 'grid', 'abc', 'ly', 'svg', 'textblock']);

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Strip a UTF-8 BOM if present and normalise line endings.
 * @param {string} text
 * @returns {string}
 */
const prepareText = (text) =>
    text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/**
 * Remove inline chord markers like [Am], [C/G], [Bb7sus4] from a lyric line,
 * then collapse any resulting double-spaces and trim.
 * @param {string} line
 * @returns {string}
 */
const stripChords = (line) =>
    line.replace(/\[[^\]]*\]/g, '').replace(/ {2,}/g, ' ').trim();

/**
 * Parse a single ChordPro directive line (without the surrounding braces).
 * Handles:
 *   - "name: value"
 *   - "name value"         (space-separated, no colon)
 *   - "name"               (no value)
 *   - attribute syntax:    name label="…" or name: label="…"
 * Returns { name, value, attrs } where value is the raw string argument and
 * attrs is an object of key="value" pairs when present.
 *
 * @param {string} inner  Content between the outer { and }
 * @returns {{ name: string, value: string, attrs: Object<string,string> }}
 */
const parseDirective = (inner) => {
    // Strip optional conditional suffix like -guitar, -soprano, -alto!
    const cleaned = inner.replace(/[-][a-z0-9_!]+$/, '').trim();

    // Split on first colon or first whitespace to get the directive name
    const colonIdx = cleaned.indexOf(':');
    const spaceIdx = cleaned.search(/\s/);

    let name, rest;

    if (colonIdx !== -1 && (spaceIdx === -1 || colonIdx < spaceIdx)) {
        name = cleaned.slice(0, colonIdx).trim().toLowerCase();
        rest = cleaned.slice(colonIdx + 1).trim();
    } else if (spaceIdx !== -1) {
        name = cleaned.slice(0, spaceIdx).trim().toLowerCase();
        rest = cleaned.slice(spaceIdx + 1).trim();
    } else {
        name = cleaned.toLowerCase();
        rest = '';
    }

    // Parse HTML-style attributes from rest if present
    const attrs = {};
    const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch;

    while ((attrMatch = attrRe.exec(rest)) !== null) {
        attrs[attrMatch[1].toLowerCase()] = attrMatch[2] ?? attrMatch[3] ?? '';
    }

    // If a label attribute is present, use it as the primary value too
    const value = attrs.label !== undefined ? attrs.label : rest.replace(attrRe, '').trim();

    return { name, value, attrs };
};

/**
 * Extract the section environment type name from a directive name like
 * "start_of_chorus" → "chorus", "soc" → "chorus", "start_of_verse" → "verse".
 * Returns null if the directive is not a section-open directive.
 *
 * @param {string} directiveName
 * @returns {string|null}
 */
const parseSectionOpenName = (directiveName) => {
    // Long form: start_of_<env>
    const longMatch = directiveName.match(/^start_of_(.+)$/);

    if (longMatch) {
        return longMatch[1].replace(/_/g, '-');
    }

    // Short forms: soc → chorus, sov → verse, sob → bridge, sot → tab, etc.
    const shortMap = {
        soc: 'chorus',
        sov: 'verse',
        sob: 'bridge',
        sot: 'tab',
        sog: 'grid',
        sopc: 'pre-chorus',
    };

    return shortMap[directiveName] ?? null;
};

/**
 * Determine whether a directive name is a section-close directive.
 * @param {string} directiveName
 * @returns {boolean}
 */
const isSectionClose = (directiveName) => {
    if (directiveName.startsWith('end_of_')) {
        return true;
    }

    const shortCloses = new Set(['eoc', 'eov', 'eob', 'eot', 'eog']);
    return shortCloses.has(directiveName);
};

// ---------------------------------------------------------------------------
// Phase 1 — Tokeniser
// ---------------------------------------------------------------------------

/**
 * Tokenise a ChordPro text into an array of typed tokens.
 *
 * Token shapes:
 *   { type: 'directive',      name, value, attrs }
 *   { type: 'section-open',   envName, beameeType, label, ignored }
 *   { type: 'section-close' }
 *   { type: 'chorus-repeat' }   ← bare {chorus} with no start/end
 *   { type: 'new-song' }
 *   { type: 'lyric',          text }   ← chord markers already stripped
 *   { type: 'blank' }
 *
 * @param {string} text
 * @returns {Array}
 */
const tokenise = (text) => {
    const tokens = [];
    const lines = prepareText(text).split('\n');

    for (const raw of lines) {
        const line = raw.trimEnd();

        // Comment lines starting with #
        if (line.trimStart().startsWith('#')) {
            continue;
        }

        // Blank line
        if (line.trim() === '') {
            tokens.push({ type: 'blank' });
            continue;
        }

        // Directive line: starts with { and ends with }
        const directiveMatch = line.match(/^\s*\{([^}]*)\}\s*$/);

        if (directiveMatch) {
            const { name, value, attrs } = parseDirective(directiveMatch[1]);

            // new_song / ns
            if (name === 'new_song' || name === 'ns') {
                tokens.push({ type: 'new-song' });
                continue;
            }

            // Section close
            if (isSectionClose(name)) {
                tokens.push({ type: 'section-close' });
                continue;
            }

            // Section open
            const envName = parseSectionOpenName(name);

            if (envName !== null) {
                const beameeType = ENV_TYPE_MAP[envName] ?? 'other';
                const ignored = IGNORED_ENVS.has(envName);
                const label = attrs.label || value || undefined;
                tokens.push({ type: 'section-open', envName, beameeType, label, ignored });
                continue;
            }

            // Bare {chorus} — a repeat/call directive (no start/end)
            if (name === 'chorus' || name === 'c') {
                tokens.push({ type: 'chorus-repeat', label: value || undefined });
                continue;
            }

            // Everything else is a metadata/formatting directive
            tokens.push({ type: 'directive', name, value, attrs });
            continue;
        }

        // Lyric line (may contain inline chords — strip them)
        tokens.push({ type: 'lyric', text: stripChords(line) });
    }

    return tokens;
};

// ---------------------------------------------------------------------------
// Phase 2 — Raw song builder
// ---------------------------------------------------------------------------

/**
 * Build a single raw song object from a flat array of tokens that belong to
 * one song (already split on new_song boundaries).
 *
 * @param {Array}  tokens
 * @param {string} fileStem   Filename without extension, used as fallback id/name.
 * @param {number} songIndex  0-based index within the file (for multi-song files).
 * @returns {Object}  Raw song object (before normalizeSong/validateSong).
 */
const buildRawSong = (tokens, fileStem, songIndex) => {
    // Metadata accumulators
    let title = '';
    const authors = [];
    const tags = [];
    const noteLines = [];

    // Section accumulators
    const sections = [];
    const arrangement = [];

    // Tracking state
    let inSection = false;
    let ignoringSection = false;   // inside a tab/grid/etc. block
    let currentType = 'verse';
    let currentLabel = undefined;
    let currentLines = [];

    // Track the first chorus section id so {chorus} repeats can reference it
    let firstChorusSectionId = null;

    // We'll assign deterministic ids later; use a counter per type
    const typeCounters = {};

    const allocateSectionId = (type, label) => {
        const base = label
            ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || type
            : type;
        typeCounters[base] = (typeCounters[base] || 0) + 1;
        const count = typeCounters[base];
        return count === 1 ? base : `${base}-${count}`;
    };

    const flushSection = () => {
        if (!inSection) return;

        // Drop trailing blank lines from the section
        while (currentLines.length > 0 && currentLines[currentLines.length - 1] === '') {
            currentLines.pop();
        }

        // Only emit non-empty sections
        if (currentLines.length > 0) {
            const id = allocateSectionId(currentType, currentLabel);
            sections.push({
                id,
                type: currentType,
                title: currentLabel,
                lines: currentLines,
            });
            arrangement.push({ sectionId: id });

            if (currentType === 'chorus' && firstChorusSectionId === null) {
                firstChorusSectionId = id;
            }
        }

        inSection = false;
        ignoringSection = false;
        currentLines = [];
        currentLabel = undefined;
    };

    // ---- Main token loop ----

    for (const token of tokens) {
        switch (token.type) {
            case 'directive': {
                const { name, value } = token;

                switch (name) {
                    case 'title':
                    case 't':
                        if (!title) title = value;
                        break;

                    case 'artist':
                    case 'composer':
                    case 'lyricist':
                        if (value) authors.push(value);
                        break;

                    case 'tag':
                        if (value) tags.push(value);
                        break;

                    case 'subtitle':
                        if (value) noteLines.push(`Subtitle: ${value}`);
                        break;

                    case 'key':
                        if (value) noteLines.push(`Key: ${value}`);
                        break;

                    case 'capo':
                        if (value) noteLines.push(`Capo: ${value}`);
                        break;

                    case 'tempo':
                        if (value) noteLines.push(`Tempo: ${value}`);
                        break;

                    case 'comment':
                    case 'c':
                    case 'highlight':
                    case 'comment_italic':
                    case 'ci':
                    case 'comment_box':
                    case 'cb': {
                        // A {comment: Chorus} style line inside a sectionless file or
                        // between sections acts as a section-label hint. If we're not
                        // currently inside a section, treat this as a hint for the next
                        // paragraph's type.
                        //
                        // If we ARE inside a section, add the comment text as a lyric line.
                        if (inSection && !ignoringSection) {
                            if (value) currentLines.push(value);
                        }
                        // (Outside a section the comment is a structural hint — handled
                        // in the paragraph-splitting fallback below, not here.)
                        break;
                    }

                    // All other directives (define, chord, textfont, chordfont, etc.) — ignore
                    default:
                        break;
                }

                break;
            }

            case 'section-open':
                // Close any currently open section first
                flushSection();
                inSection = true;
                ignoringSection = token.ignored;
                currentType = token.beameeType;
                currentLabel = token.label;
                currentLines = [];
                break;

            case 'section-close':
                flushSection();
                break;

            case 'chorus-repeat':
                // Flush any open section, then add an arrangement repeat
                flushSection();

                if (firstChorusSectionId) {
                    arrangement.push({ sectionId: firstChorusSectionId });
                }

                break;

            case 'new-song':
                // Handled at a higher level — should not appear here
                break;

            case 'lyric':
                if (inSection && !ignoringSection) {
                    currentLines.push(token.text);
                }

                // Lines outside any section are collected in the paragraph-
                // splitting fallback path; they are ignored here because the
                // caller already chose the right path (explicit vs. implicit).
                break;

            case 'blank':
                if (inSection && !ignoringSection) {
                    currentLines.push('');
                }

                break;

            default:
                break;
        }
    }

    // Flush any trailing open section
    flushSection();

    return {
        schemaVersion: 1,
        id: '',           // will be set by normalizeSong via sourcePath / name
        name: title,
        authors,
        collections: [],
        sections,
        arrangement,
        tags,
        notes: noteLines.length > 0 ? noteLines.join('\n') : undefined,
        _fileStem: `${fileStem}${songIndex > 0 ? `-${songIndex + 1}` : ''}`,
    };
};

// ---------------------------------------------------------------------------
// Phase 3 — Paragraph-split fallback (sectionless files)
// ---------------------------------------------------------------------------

/**
 * Determine whether a token array contains any explicit section environment
 * directives (start_of_* / soc / sov / etc.).
 *
 * @param {Array} tokens
 * @returns {boolean}
 */
const hasExplicitSections = (tokens) =>
    tokens.some((t) => t.type === 'section-open');

/**
 * For files with no explicit section environment directives, split lyric
 * content into paragraphs separated by blank lines and build raw song sections
 * from those paragraphs.
 *
 * A paragraph preceded by a {comment: Chorus}-style token is typed as
 * 'chorus'. All other paragraphs are typed as 'verse'.
 *
 * @param {Array}  tokens
 * @param {string} fileStem
 * @param {number} songIndex
 * @returns {Object}  Raw song object.
 */
const buildRawSongFromParagraphs = (tokens, fileStem, songIndex) => {
    // Metadata accumulators (same logic as buildRawSong)
    let title = '';
    const authors = [];
    const tags = [];
    const noteLines = [];

    // We'll build a flat list of { nextType, lines } blocks
    const blocks = [];       // { type: 'verse'|'chorus', label?: string, lines: string[] }
    let currentBlock = null;
    let pendingType = 'verse';
    let pendingLabel = undefined;

    const flushBlock = () => {
        if (!currentBlock) return;

        // Trim trailing blank lines
        while (currentBlock.lines.length > 0 && currentBlock.lines[currentBlock.lines.length - 1] === '') {
            currentBlock.lines.pop();
        }

        if (currentBlock.lines.length > 0) {
            blocks.push(currentBlock);
        }

        currentBlock = null;
    };

    for (const token of tokens) {
        switch (token.type) {
            case 'directive': {
                const { name, value } = token;

                switch (name) {
                    case 'title': case 't':
                        if (!title) title = value;
                        break;
                    case 'artist': case 'composer': case 'lyricist':
                        if (value) authors.push(value);
                        break;
                    case 'tag':
                        if (value) tags.push(value);
                        break;
                    case 'subtitle':
                        if (value) noteLines.push(`Subtitle: ${value}`);
                        break;
                    case 'key':
                        if (value) noteLines.push(`Key: ${value}`);
                        break;
                    case 'capo':
                        if (value) noteLines.push(`Capo: ${value}`);
                        break;
                    case 'tempo':
                        if (value) noteLines.push(`Tempo: ${value}`);
                        break;
                    case 'comment':
                    case 'c':
                    case 'highlight':
                    case 'comment_italic':
                    case 'ci':
                    case 'comment_box':
                    case 'cb': {
                        // Check if this looks like a chorus label hint
                        const lower = (value || '').toLowerCase();
                        const isChorusHint = lower.includes('chorus') || lower.includes('refrain') || lower.includes('refrão');

                        // Flush the current block — this comment marks the start of a new section
                        flushBlock();
                        pendingType = isChorusHint ? 'chorus' : 'other';
                        pendingLabel = value || undefined;
                        break;
                    }
                    default:
                        break;
                }

                break;
            }

            case 'lyric': {
                if (!currentBlock) {
                    currentBlock = { type: pendingType, label: pendingLabel, lines: [] };
                    pendingType = 'verse';
                    pendingLabel = undefined;
                }

                currentBlock.lines.push(token.text);
                break;
            }

            case 'blank': {
                // A blank line is a paragraph separator — flush the current block.
                // The next lyric line will start a new block using pendingType.
                flushBlock();
                // Reset a non-verse pending hint on consecutive blank lines to
                // avoid accidentally carrying a {comment} hint past extra whitespace.
                if (pendingType === 'other') {
                    pendingType = 'verse';
                    pendingLabel = undefined;
                }

                break;
            }

            case 'chorus-repeat':
                // No explicit sections, so chorus-repeat is ignored (nothing to repeat)
                break;

            default:
                break;
        }
    }

    flushBlock();

    // Build sections and arrangement from blocks
    const sections = [];
    const arrangement = [];
    const typeCounters = {};

    const allocateSectionId = (type, label) => {
        const base = label
            ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || type
            : type;
        typeCounters[base] = (typeCounters[base] || 0) + 1;
        const count = typeCounters[base];
        return count === 1 ? base : `${base}-${count}`;
    };

    for (const block of blocks) {
        const id = allocateSectionId(block.type, block.label);
        sections.push({
            id,
            type: block.type,
            title: block.label,
            lines: block.lines,
        });
        arrangement.push({ sectionId: id });
    }

    return {
        schemaVersion: 1,
        id: '',
        name: title,
        authors,
        collections: [],
        sections,
        arrangement,
        tags,
        notes: noteLines.length > 0 ? noteLines.join('\n') : undefined,
        _fileStem: `${fileStem}${songIndex > 0 ? `-${songIndex + 1}` : ''}`,
    };
};

// ---------------------------------------------------------------------------
// Phase 4 — Multi-song splitter
// ---------------------------------------------------------------------------

/**
 * Split a flat token array into groups separated by {new_song} tokens.
 *
 * @param {Array} tokens
 * @returns {Array<Array>}  One sub-array per song.
 */
const splitOnNewSong = (tokens) => {
    const groups = [];
    let current = [];

    for (const token of tokens) {
        if (token.type === 'new-song') {
            if (current.length > 0) {
                groups.push(current);
            }

            current = [];
        } else {
            current.push(token);
        }
    }

    if (current.length > 0) {
        groups.push(current);
    }

    return groups.length > 0 ? groups : [[]];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a ChordPro file's text content into one or more raw song objects.
 *
 * Each returned object is ready to pass to:
 *   songSchema.normalizeSong(rawSong, { sourcePath: virtualPath })
 *
 * A private `_fileStem` property is included to help the caller construct a
 * virtual sourcePath for normalizeSong; callers should strip it before
 * passing to validateSong.
 *
 * @param {string} text      Full UTF-8 text of the .cho / .crd / etc. file.
 * @param {string} fileStem  Filename without extension (used as id/name fallback).
 * @returns {Array<Object>}  Array of raw song objects (one per {new_song} block).
 */
const convertChordPro = (text, fileStem) => {
    const tokens = tokenise(text);
    const groups = splitOnNewSong(tokens);

    return groups.map((groupTokens, index) => {
        if (hasExplicitSections(groupTokens)) {
            return buildRawSong(groupTokens, fileStem, index);
        }

        return buildRawSongFromParagraphs(groupTokens, fileStem, index);
    });
};

module.exports = { convertChordPro };
