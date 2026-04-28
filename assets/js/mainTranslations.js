'use strict';

/**
 * Main-process translation strings.
 *
 * Mirrors the renderer locale files for all strings that appear in
 * Electron native menus, context menus, and dialog boxes.
 *
 * Usage:
 *   const { getTranslator } = require('./mainTranslations');
 *   const t = getTranslator('fr');
 *   t('menu.file')  // → 'Fichier'
 *   t('menu.verse', { n: 3 })  // → 'Verset 3'
 */

const TRANSLATIONS = {
    en: {
        'menu.file': 'File',
        'menu.importSongs': 'Import Songs...',
        'menu.importSongFolder': 'Import Song Folder...',
        'menu.newSong': 'New Song...',
        'menu.exportSongJson': 'Export Current Song JSON',
        'menu.exportSongPdf': 'Export Current Song PDF',
        'menu.exportLibraryZip': 'Export Library as Zip',
        'menu.checkForUpdate': 'Check for update...',
        'menu.preferences': 'Preferences',
        'menu.quit': 'Quit',
        'menu.edit': 'Edit',
        'menu.editSong': 'Edit song...',
        'menu.controls': 'Controls',
        'menu.toggleProjection': 'Start/stop projection',
        'menu.nextVerse': 'Next verse',
        'menu.prevVerse': 'Previous verse',
        'menu.chorus': 'Chorus',
        'menu.blackScreen': 'Black screen',
        'menu.verse': 'Verse {n}',

        'contextMenu.rename': 'Rename',
        'contextMenu.delete': 'Delete',
        'contextMenu.addToFavorites': 'Add to Favorites',
        'contextMenu.exportJson': 'Export JSON',
        'contextMenu.exportPdf': 'Export PDF',
        'contextMenu.deleteSong': 'Delete Song',
        'contextMenu.exportCollectionZip': 'Export Collection as Zip',
        'contextMenu.deleteCollection': 'Delete Collection',
        'contextMenu.deleteFromFavorites': 'Delete from Favorites',

        'dialog.ok': 'OK',
        'dialog.unsavedChanges.title': 'Unsaved changes',
        'dialog.unsavedChanges.message': 'This song has unsaved changes.',
        'dialog.unsavedChanges.detail': 'Do you want to discard them, save them, or stay in the editor?',
        'dialog.unsavedChanges.discard': 'Discard',
        'dialog.unsavedChanges.save': 'Save',
        'dialog.unsavedChanges.cancel': 'Cancel',
        'dialog.deleteSong.title': 'Delete song?',
        'dialog.deleteSong.message': 'Delete "{name}"?',
        'dialog.deleteSong.detail': 'This will remove the song file and any favorites that reference it.',
        'dialog.deleteSong.confirm': 'Delete Song',
        'dialog.deleteSong.cancel': 'Cancel',
        'dialog.deleteSong.failTitle': 'Delete failed',
        'dialog.deleteSong.failMessage': 'Unable to delete song.',
        'dialog.deleteCollection.title': 'Delete collection?',
        'dialog.deleteCollection.message': 'Delete collection "{name}"?',
        'dialog.deleteCollection.detailWithCount': '{removable} song file(s) will be deleted and {retained} song(s) will stay in other collection(s).',
        'dialog.deleteCollection.detailNoCount': 'This collection will be removed from the songs that use it.',
        'dialog.deleteCollection.confirm': 'Delete Collection',
        'dialog.deleteCollection.cancel': 'Cancel',
        'dialog.exportPdf.title': 'Export PDF',
        'dialog.exportPdf.message': 'Export the selected song as a printable PDF?',
        'dialog.exportPdf.useArrangement': 'Use arrangement',
        'dialog.exportPdf.export': 'Export',
        'dialog.exportPdf.cancel': 'Cancel',
        'sectionType.verse': 'Verse',
        'sectionType.chorus': 'Chorus',
        'sectionType.pre-chorus': 'Pre-chorus',
        'sectionType.bridge': 'Bridge',
        'sectionType.intro': 'Intro',
        'sectionType.outro': 'Outro',
        'sectionType.tag': 'Tag',
        'sectionType.other': 'Other',
    },
    fr: {
        'menu.file': 'Fichier',
        'menu.importSongs': 'Importer des chants...',
        'menu.importSongFolder': 'Importer un dossier...',
        'menu.newSong': 'Nouveau chant...',
        'menu.exportSongJson': 'Exporter le chant (JSON)',
        'menu.exportSongPdf': 'Exporter le chant (PDF)',
        'menu.exportLibraryZip': 'Exporter la bibliothèque (Zip)',
        'menu.checkForUpdate': 'Rechercher une mise à jour...',
        'menu.preferences': 'Préférences',
        'menu.quit': 'Quitter',
        'menu.edit': 'Édition',
        'menu.editSong': 'Modifier le chant...',
        'menu.controls': 'Contrôles',
        'menu.toggleProjection': 'Démarrer/arrêter la projection',
        'menu.nextVerse': 'Verset suivant',
        'menu.prevVerse': 'Verset précédent',
        'menu.chorus': 'Refrain',
        'menu.blackScreen': 'Écran noir',
        'menu.verse': 'Verset {n}',

        'contextMenu.rename': 'Renommer',
        'contextMenu.delete': 'Supprimer',
        'contextMenu.addToFavorites': 'Ajouter aux favoris',
        'contextMenu.exportJson': 'Exporter (JSON)',
        'contextMenu.exportPdf': 'Exporter (PDF)',
        'contextMenu.deleteSong': 'Supprimer le chant',
        'contextMenu.exportCollectionZip': 'Exporter le recueil (Zip)',
        'contextMenu.deleteCollection': 'Supprimer le recueil',
        'contextMenu.deleteFromFavorites': 'Retirer des favoris',

        'dialog.ok': 'OK',
        'dialog.unsavedChanges.title': 'Modifications non enregistrées',
        'dialog.unsavedChanges.message': 'Ce chant a des modifications non enregistrées.',
        'dialog.unsavedChanges.detail': 'Voulez-vous les ignorer, les enregistrer ou rester dans l\'éditeur\u00a0?',
        'dialog.unsavedChanges.discard': 'Ignorer',
        'dialog.unsavedChanges.save': 'Enregistrer',
        'dialog.unsavedChanges.cancel': 'Annuler',
        'dialog.deleteSong.title': 'Supprimer le chant\u00a0?',
        'dialog.deleteSong.message': 'Supprimer \u00ab\u00a0{name}\u00a0\u00bb\u00a0?',
        'dialog.deleteSong.detail': 'Le fichier et les favoris associés seront supprimés.',
        'dialog.deleteSong.confirm': 'Supprimer le chant',
        'dialog.deleteSong.cancel': 'Annuler',
        'dialog.deleteSong.failTitle': 'Échec de la suppression',
        'dialog.deleteSong.failMessage': 'Impossible de supprimer le chant.',
        'dialog.deleteCollection.title': 'Supprimer le recueil\u00a0?',
        'dialog.deleteCollection.message': 'Supprimer le recueil \u00ab\u00a0{name}\u00a0\u00bb\u00a0?',
        'dialog.deleteCollection.detailWithCount': '{removable} fichier(s) sera supprimé et {retained} chant(s) restera dans d\'autres recueils.',
        'dialog.deleteCollection.detailNoCount': 'Ce recueil sera retiré des chants qui l\'utilisent.',
        'dialog.deleteCollection.confirm': 'Supprimer le recueil',
        'dialog.deleteCollection.cancel': 'Annuler',
        'dialog.exportPdf.title': 'Exporter en PDF',
        'dialog.exportPdf.message': 'Exporter le chant sélectionné en PDF imprimable ?',
        'dialog.exportPdf.useArrangement': 'Utiliser l\'arrangement',
        'dialog.exportPdf.export': 'Exporter',
        'dialog.exportPdf.cancel': 'Annuler',
        'sectionType.verse': 'Verset',
        'sectionType.chorus': 'Refrain',
        'sectionType.pre-chorus': 'Pré-refrain',
        'sectionType.bridge': 'Pont',
        'sectionType.intro': 'Introduction',
        'sectionType.outro': 'Outro',
        'sectionType.tag': 'Tag',
        'sectionType.other': 'Autre',
    },
};

const SUPPORTED = ['en', 'fr'];
const DEFAULT_LANG = 'en';

/**
 * Return a translator function scoped to the given language.
 *
 * @param {'en'|'fr'} lang
 * @returns {(key: string, replacements?: Record<string, string|number>) => string}
 */
const getTranslator = (lang) => {
    const safeLang = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    const catalogue = TRANSLATIONS[safeLang];
    const fallback = TRANSLATIONS[DEFAULT_LANG];

    return (key, replacements) => {
        let value = catalogue[key] ?? fallback[key];

        if (typeof value !== 'string') {
            return key;
        }

        if (replacements) {
            for (const [token, replacement] of Object.entries(replacements)) {
                value = value.replaceAll(`{${token}}`, String(replacement));
            }
        }

        return value;
    };
};

module.exports = { getTranslator };
