import { b64, enc, rand, unb64 } from './bytes'

/**
 * Biometric unlock = platform authenticator (Windows Hello / Touch ID / Face ID /
 * Android BiometricPrompt) via WebAuthn with the PRF extension. The authenticator
 * returns a stable per-credential secret only after user verification; we use it
 * as a key-encryption key. No biometric data ever reaches this app.
 */

async function kdf(prf: ArrayBuffer): Promise<Uint8Array> {
  const buf = new Uint8Array(prf.byteLength + 11)
  buf.set(enc.encode('lumen/v1/bio'), 0)
  buf.set(new Uint8Array(prf), 11)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  } catch { return false }
}

export async function enrollBiometric(): Promise<{ credId: string; salt: string; secret: Uint8Array }> {
  const salt = rand(32)
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Lumen' },
      user: { id: rand(16), name: 'lumen-vault', displayName: 'Lumen Vault' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('cancelled')
  const credId = b64(new Uint8Array(cred.rawId))
  const secret = await getSecret(credId, b64(salt)) // always re-derive via get() for consistency
  return { credId, salt: b64(salt), secret }
}

export async function getSecret(credId: string, salt: string): Promise<Uint8Array> {
  const a = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: unb64(credId) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: unb64(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  const ext = a?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined
  const first = ext?.prf?.results?.first
  if (!first) throw new Error('prf-unsupported')
  return kdf(first)
}
