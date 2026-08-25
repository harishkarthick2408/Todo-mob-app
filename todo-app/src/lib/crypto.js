// All cryptography here uses the browser/WebView-native Web Crypto API
// (SubtleCrypto). No custom cipher implementations, per security policy.

const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Derive an AES-GCM key from a password using PBKDF2 (200k iterations, SHA-256). */
export async function deriveKey(password, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  return { key, saltB64: toB64(salt) }
}

/** Generate a random, non-exportable-in-practice local device key (kept in Preferences). */
export function generateDeviceKeyB64() {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return toB64(raw)
}

export async function importRawKey(rawKeyB64) {
  return crypto.subtle.importKey('raw', fromB64(rawKeyB64), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptString(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return { iv: toB64(iv), ct: toB64(ct) }
}

export async function decryptString(payload, key) {
  const iv = fromB64(payload.iv)
  const ct = fromB64(payload.ct)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return dec.decode(pt)
}

/** Password-based encrypted backup blob: { salt, iv, ct } — self-contained, portable. */
export async function encryptBackup(json, password) {
  const { key, saltB64 } = await deriveKey(password)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json))
  return { v: 1, salt: saltB64, iv: toB64(iv), ct: toB64(ct) }
}

export async function decryptBackup(blob, password) {
  const { key } = await deriveKey(password, blob.salt)
  const iv = fromB64(blob.iv)
  const ct = fromB64(blob.ct)
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return dec.decode(pt)
  } catch {
    throw new Error('WRONG_PASSWORD_OR_CORRUPT')
  }
}

/** Hash a PIN for storage (never store the raw PIN). PBKDF2, salted. */
export async function hashPin(pin) {
  const { key, saltB64 } = await deriveKey('pin:' + pin)
  const raw = await crypto.subtle.exportKey('raw', key)
  return { hash: toB64(raw), salt: saltB64 }
}
export async function verifyPin(pin, stored) {
  const { key } = await deriveKey('pin:' + pin, stored.salt)
  const raw = await crypto.subtle.exportKey('raw', key)
  return toB64(raw) === stored.hash
}
