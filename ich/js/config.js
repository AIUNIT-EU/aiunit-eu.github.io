// Zentrale Produktkonfiguration. Der Name ist austauschbar (ICH oder ME), siehe docs/PRODUCT.md.
// Hinweis: manifest.webmanifest und <title> in index.html enthalten den Namen zusätzlich statisch
// (Manifeste können nicht zur Laufzeit geändert werden) und müssen bei einer Umbenennung mitgeändert werden.
export const APP_NAME = 'ICH';
export const APP_VERSION = '0.7.0';
export const BACKUP_EXTENSION = '.ichbackup';
export const BACKUP_REMIND_DAYS = 14;      // Erinnerung, wenn die letzte Sicherung älter ist
export const AUDIO_MAX_SECONDS = 300;      // Produktvorgabe MVP: 5 Minuten pro Aufnahme
