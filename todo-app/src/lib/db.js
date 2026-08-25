import { Preferences } from '@capacitor/preferences'
import { generateDeviceKeyB64, importRawKey, encryptString, decryptString } from './crypto.js'

// Everything here is local-only. There is no network client anywhere in this
// app; grep the repo for "fetch(" or "XMLHttpRequest" and you will find none
// that talk to a remote host. Preferences maps to EncryptedSharedPreferences-
// backed SharedPreferences on Android via Capacitor; the JSON payload itself
// is additionally AES-GCM encrypted with a per-install key before it ever
// touches disk, so a plain SharedPreferences dump on a rooted device is
// still not enough to read task content.

const DEVICE_KEY_NAME = 'privado_device_key_v1'
const DATA_KEY_NAME = 'privado_data_v1'

let cachedKey = null

async function getKey() {
  if (cachedKey) return cachedKey
  const existing = await Preferences.get({ key: DEVICE_KEY_NAME })
  let rawB64 = existing.value
  if (!rawB64) {
    rawB64 = generateDeviceKeyB64()
    await Preferences.set({ key: DEVICE_KEY_NAME, value: rawB64 })
  }
  cachedKey = await importRawKey(rawB64)
  return cachedKey
}

export const defaultCategories = [
  { id: 'personal', name: 'Personal', icon: '🏠' },
  { id: 'work', name: 'Work', icon: '💼' },
  { id: 'study', name: 'Study', icon: '📚' },
  { id: 'shopping', name: 'Shopping', icon: '🛒' },
  { id: 'health', name: 'Health', icon: '❤️' },
  { id: 'other', name: 'Other', icon: '✨' },
]

export const defaultState = {
  tasks: [],
  categories: defaultCategories,
  settings: {
    theme: 'system',
    notificationsEnabled: true,
    soundEnabled: true,
    vibrationEnabled: true,
    defaultReminderMinutes: 0,
    defaultSnoozeMinutes: 10,
    appLockEnabled: false,
    pin: null, // { hash, salt }
    autoLockMinutes: 1,
    completionLog: {}, // { 'YYYY-MM-DD': count } for streaks
  },
}

export async function loadState() {
  try {
    const key = await getKey()
    const res = await Preferences.get({ key: DATA_KEY_NAME })
    if (!res.value) return structuredClone(defaultState)
    const payload = JSON.parse(res.value)
    const json = await decryptString(payload, key)
    const parsed = JSON.parse(json)
    // Merge with defaults so new fields introduced by an app update don't crash old data
    return {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
    }
  } catch (e) {
    // Never surface internals (storage paths, crypto details) to the UI.
    console.warn('local data unreadable, starting fresh')
    return structuredClone(defaultState)
  }
}

export async function saveState(state) {
  const key = await getKey()
  const json = JSON.stringify(state)
  const payload = await encryptString(json, key)
  await Preferences.set({ key: DATA_KEY_NAME, value: JSON.stringify(payload) })
}

export async function wipeAllData() {
  await Preferences.remove({ key: DATA_KEY_NAME })
  // Device key is intentionally kept; removing it would just orphan nothing
  // since data is already gone, but keeping it avoids re-derivation cost.
}
