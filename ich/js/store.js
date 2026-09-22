// Lokaler Speicher (IndexedDB). Es werden ausschließlich verschlüsselte Daten abgelegt.
// Stores:
//   meta    – { k: 'vault', format: 2, kdf, wrapped, recovery? }  (Format 1: { salt, iterations, verifier })
//   records – { id, v, iv, data }  verschlüsselter JSON-Datensatz (v: 2 = mit AAD an die ID gebunden)
//   blobs   – { id, v, iv, data }  verschlüsselte Binärdaten (Sprachaufnahmen, gescannte Dokumentseiten)

import { encryptJSON, decryptJSON, encryptBytes, decryptBytes, aad, sha256Hex, toB64, fromB64 } from './crypto.js';

const DB_NAME = 'ich-vault';
const DB_VERSION = 1;
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('meta', { keyPath: 'k' });
        db.createObjectStore('records', { keyPath: 'id' });
        db.createObjectStore('blobs', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function friendly(err) {
  if (err?.name === 'QuotaExceededError') {
    return new Error('Der Speicher auf diesem Gerät ist voll. Es wurde nichts gespeichert. Bitte Platz schaffen oder alte Aufnahmen löschen.');
  }
  return err || new Error('Speichern fehlgeschlagen.');
}

// Eine Transaktion; resolved erst nach erfolgreichem Abschluss (oncomplete), sonst Fehler.
function tx(storeNames, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    let t;
    try {
      t = db.transaction(storeNames, mode);
    } catch (e) {
      reject(friendly(e));
      return;
    }
    let result;
    try {
      result = fn(t);
    } catch (e) {
      try { t.abort(); } catch { /* bereits beendet */ }
      reject(friendly(e));
      return;
    }
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(friendly(t.error));
    t.onabort = () => reject(friendly(t.error));
  }));
}

export const getVault = () => tx(['meta'], 'readonly', t => t.objectStore('meta').get('vault'));
export const putVault = vault => tx(['meta'], 'readwrite', t => { t.objectStore('meta').put({ ...vault, k: 'vault' }); });

// ---------- Datensätze ----------

export async function saveRecord(key, record) {
  const box = await encryptJSON(key, record, aad.record(record.id));
  await tx(['records'], 'readwrite', t => { t.objectStore('records').put({ id: record.id, v: 2, ...box }); });
}

export function decryptRow(key, row) {
  return decryptJSON(key, row, row.v === 2 ? aad.record(row.id) : undefined);
}

export async function loadRecords(key) {
  const rows = await tx(['records'], 'readonly', t => t.objectStore('records').getAll());
  return Promise.all(rows.map(r => decryptRow(key, r)));
}

export async function deleteRecord(id, blobIds = []) {
  await tx(['records', 'blobs'], 'readwrite', t => {
    t.objectStore('records').delete(id);
    blobIds.forEach(b => t.objectStore('blobs').delete(b));
  });
}

export async function deleteBlobs(ids) {
  await tx(['blobs'], 'readwrite', t => { ids.forEach(b => t.objectStore('blobs').delete(b)); });
}

export async function saveBlob(key, id, bytes) {
  const box = await encryptBytes(key, bytes, aad.blob(id));
  await tx(['blobs'], 'readwrite', t => { t.objectStore('blobs').put({ id, v: 2, ...box }); });
}

export function decryptBlobRow(key, row) {
  return decryptBytes(key, row, row.v === 2 ? aad.blob(row.id) : undefined);
}

export async function loadBlob(key, id) {
  const row = await tx(['blobs'], 'readonly', t => t.objectStore('blobs').get(id));
  return row ? decryptBlobRow(key, row) : null;
}

export const countRows = () => tx(['records', 'blobs'], 'readonly', t => {
  const out = { records: 0, blobs: 0 };
  t.objectStore('records').count().onsuccess = e => { out.records = e.target.result; };
  t.objectStore('blobs').count().onsuccess = e => { out.blobs = e.target.result; };
  return out;
});

// ---------- Sicherung (.ichbackup, Format 2) ----------

export const BACKUP_MAX_BYTES = 200 * 1024 * 1024; // MVP-Grenze, siehe docs/SECURITY.md

const packBox = b => ({ iv: toB64(b.iv), data: toB64(b.data) });
const unpackBox = b => ({ iv: fromB64(b.iv), data: fromB64(b.data) });
const rowHash = r => sha256Hex(r.iv, r.data);

export function serializeMeta(m) {
  if (m.format === 2) {
    return {
      format: 2,
      kdf: { alg: m.kdf.alg, iterations: m.kdf.iterations, salt: toB64(m.kdf.salt) },
      wrapped: packBox(m.wrapped),
      recovery: m.recovery ? { alg: m.recovery.alg, salt: toB64(m.recovery.salt), wrapped: packBox(m.recovery.wrapped), createdAt: m.recovery.createdAt } : null,
    };
  }
  return { format: 1, salt: toB64(m.salt), iterations: m.iterations, verifier: packBox(m.verifier) };
}

function deserializeMeta(s) {
  if (s?.format === 2) {
    const meta = {
      format: 2,
      kdf: { alg: String(s.kdf.alg), iterations: Number(s.kdf.iterations), salt: fromB64(s.kdf.salt) },
      wrapped: unpackBox(s.wrapped),
    };
    if (s.recovery) meta.recovery = { alg: String(s.recovery.alg), salt: fromB64(s.recovery.salt), wrapped: unpackBox(s.recovery.wrapped), createdAt: s.recovery.createdAt };
    if (meta.kdf.alg !== 'PBKDF2-SHA256' || meta.kdf.salt.length < 16) throw new Error('Unbekannte Schlüsselparameter.');
    return meta;
  }
  return { format: 1, salt: fromB64(s.salt), iterations: Number(s.iterations), verifier: unpackBox(s.verifier) };
}

/** Exportiert den Tresor 1:1 verschlüsselt, mit verschlüsseltem Inhaltsverzeichnis (Vollständigkeit + Integrität). */
export async function exportVault(key, appVersion) {
  const [vault, records, blobs] = await Promise.all([
    getVault(),
    tx(['records'], 'readonly', t => t.objectStore('records').getAll()),
    tx(['blobs'], 'readonly', t => t.objectStore('blobs').getAll()),
  ]);
  const exportedAt = new Date().toISOString();
  const manifest = {
    exportedAt,
    records: await Promise.all(records.map(async r => [r.id, r.v || 1, await rowHash(r)])),
    blobs: await Promise.all(blobs.map(async b => [b.id, b.v || 1, await rowHash(b)])),
  };
  const pack = r => ({ id: r.id, v: r.v || 1, ...packBox(r) });
  return {
    format: 'ich-backup',
    version: 2,
    app: appVersion,
    exportedAt,
    vault: serializeMeta(vault),
    records: records.map(pack),
    blobs: blobs.map(pack),
    manifest: packBox(await encryptJSON(key, manifest, aad.manifest)),
  };
}

/** Liest eine Sicherungsdatei (Format 1 oder 2) ein, ohne sie zu aktivieren. */
export function parseBackup(json) {
  if (json?.format !== 'ich-backup' || ![1, 2].includes(json.version)) throw new Error('Keine gültige ICH-Sicherungsdatei.');
  if (!Array.isArray(json.records) || !Array.isArray(json.blobs)) throw new Error('Sicherungsdatei ist unvollständig.');
  const unpack = r => {
    if (typeof r?.id !== 'string' || !r.id || r.id.length > 100) throw new Error('Ungültiger Eintrag in der Sicherung.');
    return { id: r.id, v: r.v === 2 ? 2 : 1, ...unpackBox(r) };
  };
  let vault;
  try {
    vault = deserializeMeta(json.version === 1 ? { format: 1, ...json.vault } : json.vault);
  } catch (e) {
    throw new Error(`Kopfdaten der Sicherung sind beschädigt (${e.message}).`);
  }
  return {
    version: json.version,
    exportedAt: json.exportedAt || null,
    vault,
    records: json.records.map(unpack),
    blobs: json.blobs.map(unpack),
    manifest: json.version === 2 ? unpackBox(json.manifest) : null,
  };
}

/**
 * Prüft eine eingelesene Sicherung vollständig mit dem Tresorschlüssel der Sicherung:
 * Inhaltsverzeichnis entschlüsseln, fehlende/zusätzliche/doppelte/veränderte Einträge erkennen,
 * jeden Datensatz und jede Aufnahme entschlüsseln. Wirft bei jedem Fehler.
 */
export async function verifyBackup(backup, key) {
  const ids = rows => rows.map(r => r.id);
  const dupes = arr => arr.length !== new Set(arr).size;
  if (dupes(ids(backup.records)) || dupes(ids(backup.blobs))) throw new Error('Sicherung enthält doppelte Einträge.');

  if (backup.version === 2) {
    let manifest;
    try {
      manifest = await decryptJSON(key, backup.manifest, aad.manifest);
    } catch {
      throw new Error('Inhaltsverzeichnis der Sicherung ist beschädigt oder manipuliert.');
    }
    const check = async (rows, list, label) => {
      if (rows.length !== list.length) throw new Error(`Sicherung unvollständig: ${label} fehlen oder sind zusätzlich vorhanden.`);
      const expected = new Map(list.map(([id, v, hash]) => [id, { v, hash }]));
      for (const r of rows) {
        const e = expected.get(r.id);
        if (!e) throw new Error(`Sicherung enthält unbekannte ${label}.`);
        if (e.v !== r.v || e.hash !== await rowHash(r)) throw new Error(`${label} in der Sicherung wurden verändert.`);
      }
    };
    await check(backup.records, manifest.records, 'Einträge');
    await check(backup.blobs, manifest.blobs, 'Dateien (Aufnahmen oder Scans)');
  }

  const records = [];
  for (const r of backup.records) {
    try {
      records.push(await decryptRow(key, r));
    } catch {
      throw new Error('Ein Eintrag der Sicherung lässt sich nicht entschlüsseln (beschädigt oder vertauscht).');
    }
  }
  for (const b of backup.blobs) {
    try {
      await decryptBlobRow(key, b);
    } catch {
      throw new Error('Eine Aufnahme oder Scanseite der Sicherung lässt sich nicht entschlüsseln (beschädigt oder vertauscht).');
    }
  }
  const blobIds = new Set(ids(backup.blobs));
  const pagesOf = r => (Array.isArray(r.pages) ? r.pages : []);
  const missingAudio = records.filter(r => r.audio?.blobId && !blobIds.has(r.audio.blobId)).length;
  if (missingAudio) throw new Error(`Sicherung unvollständig: ${missingAudio} Aufnahme(n) fehlen.`);
  const missingPages = records.flatMap(pagesOf).filter(p => !blobIds.has(p?.blobId)).length;
  if (missingPages) throw new Error(`Sicherung unvollständig: ${missingPages} Dokumentseite(n) fehlen.`);
  return {
    entries: records.filter(r => r.module !== 'config').length,
    audio: records.filter(r => r.audio?.blobId).length,
    pages: records.filter(r => r.module === 'document').reduce((n, r) => n + pagesOf(r).length, 0),
    exportedAt: backup.exportedAt,
    legacy: backup.version === 1,
    byModule: records.reduce((m, r) => ({ ...m, [r.module]: (m[r.module] || 0) + 1 }), {}),
  };
}

/** Ersetzt den kompletten lokalen Tresor in EINER Transaktion (atomar). Nur nach verifyBackup aufrufen. */
export async function replaceVault({ vault, records, blobs }) {
  await tx(['meta', 'records', 'blobs'], 'readwrite', t => {
    ['records', 'blobs'].forEach(s => t.objectStore(s).clear());
    t.objectStore('meta').put({ ...vault, k: 'vault' });
    records.forEach(r => t.objectStore('records').put(r));
    blobs.forEach(b => t.objectStore('blobs').put(b));
  });
}

export async function wipeAll() {
  await tx(['meta', 'records', 'blobs'], 'readwrite', t => {
    ['meta', 'records', 'blobs'].forEach(s => t.objectStore(s).clear());
  });
}
