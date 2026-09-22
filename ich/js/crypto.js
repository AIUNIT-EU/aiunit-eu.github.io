// Kryptografie des Tresors (Web Crypto API, keine eigenen Primitive).
//
// Format 2 (ab 0.5.0), siehe docs/SECURITY.md:
//   Tresorschlüssel (DEK) = 32 zufällige Bytes, verschlüsselt Datensätze mit AES-256-GCM (96-Bit-IV je Schreibvorgang,
//   128-Bit-Tag) und AAD „ich:v2:rec:<id>“ bzw. „ich:v2:blob:<id>“.
//   Schlüssel-Verschlüsselungsschlüssel (KEK) = PBKDF2-HMAC-SHA-256(Passphrase, 16-Byte-Salt, ≥ 600.000 Iterationen).
//   Die DEK liegt nur mit der KEK verschlüsselt (AAD „ich:v2:dek“) im Speicher.
//   Optionaler Wiederherstellungsschlüssel: 160 Bit Zufall, KEK über HKDF-SHA-256, verschlüsselt die DEK separat.
// Format 1 (bis 0.4.0): Schlüssel direkt aus der Passphrase abgeleitet, Prüfwert statt DEK. Wird beim Entsperren migriert.

export const PBKDF2_ITERATIONS = 600000;
export const PBKDF2_MIN = 100000;          // Untergrenze beim Import fremder Parameter
export const PBKDF2_MAX = 5000000;         // Obergrenze (Schutz vor Ressourcen-Erschöpfung durch manipulierte Header)
const VERIFIER_TEXT = 'ICH-verifier-v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const aad = {
  dek: enc.encode('ich:v2:dek'),
  dekRecovery: enc.encode('ich:v2:dek-recovery'),
  manifest: enc.encode('ich:v2:manifest'),
  record: id => enc.encode(`ich:v2:rec:${id}`),
  blob: id => enc.encode(`ich:v2:blob:${id}`),
};

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function checkIterations(iterations) {
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN || iterations > PBKDF2_MAX) {
    throw new Error('Ungültige Schlüsselparameter im Tresor.');
  }
}

async function pbkdf2Bits(passphrase, salt, iterations) {
  checkIterations(iterations);
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256));
}

export async function importAesKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// KEK aus der Passphrase
export async function deriveKek(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const bits = await pbkdf2Bits(passphrase, salt, iterations);
  const key = await importAesKey(bits);
  bits.fill(0);
  return key;
}

// Format 1: Schlüssel direkt aus der Passphrase (nur noch zum Lesen/Migrieren)
export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  return deriveKek(passphrase, salt, iterations);
}
export async function deriveLegacyKeyBits(passphrase, salt, iterations) {
  return pbkdf2Bits(passphrase, salt, iterations);
}

export async function encryptBytes(key, bytes, additionalData) {
  const iv = randomBytes(12);
  const params = { name: 'AES-GCM', iv, tagLength: 128 };
  if (additionalData) params.additionalData = additionalData;
  const data = await crypto.subtle.encrypt(params, key, bytes);
  return { iv, data: new Uint8Array(data) };
}

export async function decryptBytes(key, { iv, data }, additionalData) {
  const params = { name: 'AES-GCM', iv, tagLength: 128 };
  if (additionalData) params.additionalData = additionalData;
  const plain = await crypto.subtle.decrypt(params, key, data);
  return new Uint8Array(plain);
}

export async function encryptJSON(key, obj, additionalData) {
  return encryptBytes(key, enc.encode(JSON.stringify(obj)), additionalData);
}

export async function decryptJSON(key, box, additionalData) {
  return JSON.parse(dec.decode(await decryptBytes(key, box, additionalData)));
}

// ---------- Tresor-Schlüssel (Format 2) ----------

/** Neuer Tresor: zufällige DEK, mit Passphrase verschlüsselt. Gibt { meta, key } zurück. */
export async function createVault(passphrase) {
  const dekRaw = randomBytes(32);
  try {
    const meta = await wrapWithPassphrase(dekRaw, passphrase);
    return { meta, key: await importAesKey(dekRaw) };
  } finally {
    dekRaw.fill(0);
  }
}

export async function wrapWithPassphrase(dekRaw, passphrase, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt, iterations);
  return { format: 2, kdf: { alg: 'PBKDF2-SHA256', iterations, salt }, wrapped: await encryptBytes(kek, dekRaw, aad.dek) };
}

/** Rohbytes der DEK mit der Passphrase entschlüsseln. Wirft bei falscher Passphrase. */
export async function unwrapWithPassphrase(meta, passphrase) {
  const kek = await deriveKek(passphrase, meta.kdf.salt, meta.kdf.iterations);
  try {
    return await decryptBytes(kek, meta.wrapped, aad.dek);
  } catch {
    throw new Error('Falsche Passphrase.');
  }
}

// ---------- Wiederherstellungsschlüssel ----------

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32 (ohne I, L, O, U)

export function encodeRecoveryCode(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out.match(/.{1,4}/g).join('-');
}

export function decodeRecoveryCode(code) {
  const clean = String(code).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 32) throw new Error('Der Wiederherstellungsschlüssel muss 32 Zeichen haben.');
  let bits = '';
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('Ungültiges Zeichen im Wiederherstellungsschlüssel.');
    bits += v.toString(2).padStart(5, '0');
  }
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

async function recoveryKek(secret, salt) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('ich:v2:recovery') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Erzeugt einen Wiederherstellungsschlüssel für die DEK. Gibt { code, recovery } zurück. */
export async function createRecovery(dekRaw) {
  const secret = randomBytes(20);
  const salt = randomBytes(16);
  const kek = await recoveryKek(secret, salt);
  const recovery = { alg: 'HKDF-SHA256', salt, wrapped: await encryptBytes(kek, dekRaw, aad.dekRecovery), createdAt: new Date().toISOString() };
  const code = encodeRecoveryCode(secret);
  secret.fill(0);
  return { code, recovery };
}

export async function unwrapWithRecovery(meta, code) {
  if (!meta.recovery) throw new Error('Für diesen Tresor ist kein Wiederherstellungsschlüssel eingerichtet.');
  const secret = decodeRecoveryCode(code);
  const kek = await recoveryKek(secret, meta.recovery.salt);
  secret.fill(0);
  try {
    return await decryptBytes(kek, meta.recovery.wrapped, aad.dekRecovery);
  } catch {
    throw new Error('Wiederherstellungsschlüssel ist falsch.');
  }
}

// ---------- Format 1 (Migration) ----------

export async function checkVerifier(key, verifier) {
  try {
    return dec.decode(await decryptBytes(key, verifier)) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

export async function createVerifier(key) {
  return encryptBytes(key, enc.encode(VERIFIER_TEXT));
}

// ---------- Hilfen ----------

export async function sha256Hex(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
