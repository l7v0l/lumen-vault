# Lumen

Password, card and secure-note manager. Local-only, end-to-end encrypted vault, PIN + biometric unlock, Arabic / English / 简体中文.

## Run (web preview, works now)
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # crypto tests
npm run build
```

## Desktop app (Tauri 2)
Needs: Rust (https://rustup.rs) and Visual Studio Build Tools 2022 ("Desktop development with C++" + Windows SDK). WebView2 ships with Windows 11.
```bash
npm run tauri dev
npm run tauri build
```
The `src-tauri` shell is scaffolded but **not yet compiled** (no Rust on the dev machine at the time of writing).

## Android
After desktop works: `npm run tauri android init` (needs Android SDK/NDK, JDK 17), then `npm run tauri android dev`.

## Layout
- `src/crypto/` — vault format, Argon2id, XChaCha20-Poly1305, PIN lockout, WebAuthn-PRF biometric, generator, tests
- `src/ui/` — intro animation (tap the bulb), unlock/create, vault, settings
- `src/i18n.tsx` — ar (RTL) / en / zh
- `docs/SECURITY.md` — design and honest limits
