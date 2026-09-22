// Tresor-Lebenszyklus: anlegen, entsperren (inkl. Migration Format 1 → 2), Passphrase ändern,
// Wiederherstellungsschlüssel, Schlüssel einer Sicherung ermitteln. Siehe docs/SECURITY.md.

import * as C from './crypto.js';
import * as store from './store.js';

export async function createNew(passphrase) {
  const { meta, key } = await C.createVault(passphrase);
  await store.putVault(meta);
  return key;
}

// DEK-Rohbytes aus Metadaten + Passphrase (Format 2) bzw. Legacy-Ableitung (Format 1)
async function dekFromPassphrase(meta, passphrase) {
  if (meta.format === 2) return C.unwrapWithPassphrase(meta, passphrase);
  const legacy = await C.deriveKey(passphrase, meta.salt, meta.iterations);
  if (!(await C.checkVerifier(legacy, meta.verifier))) throw new Error('Falsche Passphrase.');
  return C.deriveLegacyKeyBits(passphrase, meta.salt, meta.iterations);
}

/**
 * Entsperrt den lokalen Tresor. Format-1-Tresore werden dabei migriert: Der bisher abgeleitete Schlüssel
 * wird zur DEK und mit einer neuen KEK verschlüsselt gespeichert. Die Daten selbst bleiben unverändert.
 */
export async function unlock(passphrase) {
  const meta = await store.getVault();
  if (!meta) throw new Error('Kein Tresor vorhanden.');
  const raw = await dekFromPassphrase(meta, passphrase);
  try {
    let migrated = false;
    if (meta.format !== 2) {
      await store.putVault(await C.wrapWithPassphrase(raw, passphrase));
      migrated = true;
    }
    return { key: await C.importAesKey(raw), migrated };
  } finally {
    raw.fill(0);
  }
}

/** Entsperren mit Wiederherstellungsschlüssel; setzt dabei eine neue Passphrase. */
export async function recover(code, newPassphrase) {
  const meta = await store.getVault();
  if (meta?.format !== 2) throw new Error('Für diesen Tresor ist kein Wiederherstellungsschlüssel eingerichtet.');
  const raw = await C.unwrapWithRecovery(meta, code);
  try {
    const next = await C.wrapWithPassphrase(raw, newPassphrase);
    await store.putVault({ ...next, recovery: meta.recovery });
    return C.importAesKey(raw);
  } finally {
    raw.fill(0);
  }
}

export async function changePassphrase(current, next) {
  const meta = await store.getVault();
  const raw = await dekFromPassphrase(meta, current);
  try {
    const wrapped = await C.wrapWithPassphrase(raw, next);
    await store.putVault(meta.recovery ? { ...wrapped, recovery: meta.recovery } : wrapped);
  } finally {
    raw.fill(0);
  }
}

/** Erstellt (oder ersetzt) den Wiederherstellungsschlüssel. Gibt den Code zurück, der nur einmal angezeigt wird. */
export async function setupRecovery(passphrase) {
  const meta = await store.getVault();
  const raw = await dekFromPassphrase(meta, passphrase);
  try {
    const base = meta.format === 2 ? meta : await C.wrapWithPassphrase(raw, passphrase);
    const { code, recovery } = await C.createRecovery(raw);
    await store.putVault({ ...base, recovery });
    return code;
  } finally {
    raw.fill(0);
  }
}

export async function removeRecovery() {
  const meta = await store.getVault();
  if (meta?.recovery) {
    const { recovery, ...rest } = meta;
    await store.putVault(rest);
  }
}

export async function recoveryInfo() {
  const meta = await store.getVault();
  return meta?.recovery ? { createdAt: meta.recovery.createdAt } : null;
}

/** Schlüssel einer eingelesenen Sicherung mit Passphrase oder Wiederherstellungsschlüssel ermitteln. */
export async function keyForBackup(backup, { passphrase, recoveryCode }) {
  const raw = recoveryCode
    ? await C.unwrapWithRecovery(backup.vault, recoveryCode)
    : await dekFromPassphrase(backup.vault, passphrase);
  try {
    return await C.importAesKey(raw);
  } finally {
    raw.fill(0);
  }
}
