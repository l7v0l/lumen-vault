# Lumen — security design and honest limits

Lumen is a local-only vault. Nothing is sent over the network (CSP: `connect-src 'self'`).
No security product is "unbreakable". This document says what is protected, and what is not.

## Cryptography
| Piece | Choice |
|---|---|
| Vault encryption | XChaCha20-Poly1305 (`@noble/ciphers`), random 24-byte nonce per write, AAD binds each blob to its role and vault id |
| Master KDF | Argon2id (`hash-wasm`), 64 MiB, t=3, p=1, random 16-byte salt; parameters stored in file so they can be raised later |
| Key model | Random 256-bit vault key encrypts data. It is *wrapped* separately by master / PIN / biometric key-encryption keys. Changing the master password re-wraps only the key |
| PIN | 6–12 digits, Argon2id 128 MiB t=4. 5 wrong tries destroy the PIN wrapper (master password required) |
| Biometric | OS authenticator (Windows Hello, Face ID/Touch ID, Android BiometricPrompt) via WebAuthn + PRF extension. The authenticator releases a secret only after user verification; it wraps the vault key. Lumen never sees biometric data and has no face recognition of its own |
| Randomness | `crypto.getRandomValues`, unbiased rejection sampling for the password generator |
| Clipboard | Copied secrets are cleared after 20 s |
| Auto-lock | Idle timer (default 5 min); lock wipes the in-memory key (best effort) |
| Backup | `.lumen` file = master-wrapped vault only (PIN/biometric wrappers stripped) |

File format spec: see header comment in `src/crypto/vault.ts`. Tests: `npm test` (15 tests: round-trip, tamper detection, AAD binding, PIN lockout, biometric wrap, backup, generator).

## Known limits (read these)
1. **PIN attempt limit is not enforced against a file copy.** The fail counter lives in the vault file. An attacker who copies the file can brute-force a 6-digit PIN offline; Argon2id at 128 MiB makes each guess costly but a short PIN is weak by nature. A real hardware-bound limit needs the OS keystore / TPM. Planned: bind the PIN wrapper to a Windows DPAPI/TPM or Android Keystore secret in the Tauri (Rust) layer. Use 8+ digits until then.
2. **Master password strength is the real protection.** Use a long passphrase. Argon2id slows guessing; it cannot save a weak password.
3. **JavaScript memory.** Keys and decrypted items live in JS memory; `wipe()` zeroes buffers but the runtime can copy strings (decrypted fields are strings). Malware running as the user, or a memory dump while unlocked, defeats any vault.
4. **Browser storage.** In the web build the vault is in `localStorage` (encrypted). Clearing site data deletes it — export backups. The desktop build should move this to the app-data folder.
5. **Biometric requires WebAuthn PRF.** Supported by Chrome/Edge (Windows Hello, Android) and recent Safari. If unsupported, the app says so and the master password/PIN still work. If the OS credential is removed, biometric unlock stops; the master password still works.
6. **No recovery.** Forgotten master password = data is gone, by design.
7. **No independent audit.** This code has not been externally reviewed.
8. Rust core is not written yet: crypto currently runs in the webview (audited libraries). Moving the core to Rust (argon2, chacha20poly1305, zeroize) gives real memory zeroization and OS keystore binding; the file format is designed to stay unchanged.

## Roadmap
- Rust/Tauri build with OS-keystore-bound PIN and file-system vault (needs Rust + MSVC Build Tools).
- Android build (Tauri 2 mobile) with BiometricPrompt.
- E2E-encrypted sync through a user-owned cloud folder (vault file is already opaque and nonce-per-write; add per-item merge + version vector).
- TOTP codes, breach check (k-anonymity, opt-in), attachments.
