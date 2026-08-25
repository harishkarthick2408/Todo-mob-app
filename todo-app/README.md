# Privado — a local-only to-do reminder app

A privacy-first Android app: task management + reminders, with **zero network
calls anywhere in the code** (verified — see "Privacy audit" below). Built
with Capacitor + React so the UI is a real web app, but it runs inside a
**native Android app shell** with real native plugins:

- `@capacitor/local-notifications` — OS-scheduled alarms (survive app close;
  the plugin's own `BOOT_COMPLETED` receiver re-arms them after a reboot)
- `@capacitor/haptics` — real device vibration
- `@capacitor/preferences` — on-device key/value storage (all task data is
  additionally AES-GCM encrypted before it's written, see `src/lib/crypto.js`)
- `@capacitor/filesystem` + `@capacitor/share` — for the encrypted backup
  export/import flow

## What's implemented

Home dashboard (greeting, today's progress ring, quick-add with an on-device
"call mom at 7pm" parser), add/edit task sheet (title, notes, date, time,
priority, category, repeat, reminder lead time), swipe-to-complete /
swipe-to-snooze task cards, calendar view, search + filters, stats screen
(today/week/streak), full settings (notification prefs, theme, PIN app-lock
with auto-lock, data export/import), and a password-encrypted local backup
file. No analytics, no ads, no crash reporting SDK, no cloud sync — the
`INTERNET` permission isn't even requested (see `AndroidManifest.xml`).

**Known scope limits, stated plainly:** exact-alarm precision on Android
12+ depends on the user granting the "Alarms & reminders" special permission
if your target API level requires it — the plugin surfaces this via
`ensurePermissions()`; biometric (fingerprint/face) unlock isn't wired up
yet, only PIN — that would use `@capacitor/biometric` or a similar plugin as
a follow-up; encryption-at-rest uses a per-install AES key stored in
Preferences, not a hardware Keystore-backed key — fine for casual device
theft/loss but not a threat model that includes a rooted device with `adb`
access — that would mean an app-level rewrite to
`androidx.security.crypto.EncryptedSharedPreferences` if you need that bar.

## Turning this into a real, installable .apk

You can't sideload from this chat directly — Android needs the app compiled
and signed. Two ways to get the actual file, pick whichever fits:

### Option A — GitHub Actions (no Android Studio needed)

1. Push this project to a new GitHub repo (public or private, either works).
2. On GitHub, go to the **Actions** tab → **Build Android APK** → **Run workflow**.
   (It also runs automatically on every push to `main`.)
3. When it finishes (~2–3 min), open the completed run and download the
   `privado-debug-apk` artifact — that's your `app-debug.apk`.
4. Transfer it to your phone (email it to yourself, Google Drive, USB) and
   tap it to install. Android will ask you to allow installs from that
   source the first time — that's normal for an app not on the Play Store.

This produces a **debug-signed** APK — installable and fully functional, but
signed with Android's default debug key rather than a release key. Fine for
your own device; if you ever want to publish it, you'd generate a release
keystore and sign with that instead (`./gradlew assembleRelease` plus a
signing config — Android's own docs cover this well since it's account-
specific and involves a private key I shouldn't generate on your behalf).

### Option B — Local Android Studio

1. Install **Android Studio** (includes the SDK/Gradle you need).
2. Open the `android/` folder in this project as an existing project.
3. Let Gradle sync finish, then **Run ▶** with a device connected (USB
   debugging on) or an emulator — this installs and launches it directly.
4. Or **Build → Build Bundle(s)/APK(s) → Build APK(s)** to get the file
   without running it, at `android/app/build/outputs/apk/debug/app-debug.apk`.

If you edit the React source afterward, re-run `npm run build && npx cap
sync android` before rebuilding in Android Studio — that copies the new web
assets into the native project.

## Local development (preview in a browser first)

```
npm install
npm run dev
```

Opens a browser preview at the printed localhost URL. Notifications/haptics
fall back to browser APIs (Notification + Vibration) in this mode since
there's no native bridge — full native behavior only shows up in the actual
Android build.

## Privacy audit

```
grep -rn "fetch(\|XMLHttpRequest\|axios\|http://\|https://" src/ --include="*.js" --include="*.jsx"
```

The only `https://` string in the whole source is the
`androidScheme: "https"` in `capacitor.config.json`, which is Capacitor's
internal scheme for serving the app's own bundled local files to the
WebView — not a real network address.
