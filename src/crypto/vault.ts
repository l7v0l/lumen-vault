import { argon2id } from 'hash-wasm'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { b64, dec, enc, rand, unb64, wipe } from './bytes'

/**
 * Lumen vault format v1 (see docs/SECURITY.md)
 *
 *  vaultKey (random 32B) encrypts the data blob (XChaCha20-Poly1305).
 *  vaultKey is wrapped independently by up to three key-encryption keys:
 *    - master : Argon2id(masterPassword)
 *    - pin    : Argon2id(pin), attempt-limited (counter lives in the file)
 *    - bio    : secret from the OS authenticator (WebAuthn PRF / Windows Hello)
 *  Every wrap/blob has its own random 24B nonce and a context-bound AAD.
 */

export type KdfParams = { alg: 'argon2id'; salt: string; m: number; t: number; p: number }
type Sealed = { n: string; c: string }

export interface VaultFile {
  v: 1
  id: string
  kdf: KdfParams
  master: Sealed
  pin?: { kdf: KdfParams; wrap: Sealed; fails: number; max: number; dev?: boolean }
  bio?: { credId: string; salt: string; wrap: Sealed }
  data: Sealed
}

export type LoginItem = { type: 'login'; username: string; password: string; url: string; notes: string }
export type CardItem = { type: 'card'; holder: string; number: string; expiry: string; cvv: string; pin: string; bank: string; notes: string; style?: string; network?: string }
export type NoteItem = { type: 'note'; body: string }
export type Item = { id: string; title: string; fav: boolean; created: number; updated: number } & (LoginItem | CardItem | NoteItem)
export interface VaultData { items: Item[] }

export interface Session {
  file: VaultFile
  key: Uint8Array
  data: VaultData
}

export interface KdfCost { m: number; t: number; p: number }
export const MASTER_COST: KdfCost = { m: 65536, t: 3, p: 1 } // 64 MiB
export const PIN_COST: KdfCost = { m: 131072, t: 4, p: 1 } // 128 MiB (PINs are low entropy)
export const PIN_MAX_FAILS = 5
export const MIN_MASTER_LEN = 10

export class VaultError extends Error {
  constructor(public code: 'bad-password' | 'bad-pin' | 'pin-locked' | 'no-pin' | 'corrupt' | 'weak', msg?: string) {
    super(msg ?? code)
  }
}

const AAD = (kind: string, id: string) => enc.encode(`lumen/v1/${kind}/${id}`)

function seal(key: Uint8Array, plain: Uint8Array, kind: string, id: string): Sealed {
  const n = rand(24)
  const c = xchacha20poly1305(key, n, AAD(kind, id)).encrypt(plain)
  return { n: b64(n), c: b64(c) }
}

function open(key: Uint8Array, s: Sealed, kind: string, id: string): Uint8Array {
  try {
    return xchacha20poly1305(key, unb64(s.n), AAD(kind, id)).decrypt(unb64(s.c))
  } catch {
    throw new VaultError('corrupt')
  }
}

async function derive(secret: string, k: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: enc.encode(secret.normalize('NFKC')),
    salt: unb64(k.salt),
    parallelism: k.p,
    iterations: k.t,
    memorySize: k.m,
    hashLength: 32,
    outputType: 'binary',
  })
}

function newKdf(c: KdfCost): KdfParams {
  return { alg: 'argon2id', salt: b64(rand(16)), ...c }
}

export function newId(): string {
  return Array.from(rand(16), (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Rough strength estimate in bits; used for the UI meter. */
export function estimateBits(pw: string): number {
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/\d/.test(pw)) pool += 10
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33
  if (!pool) return 0
  const eff = Math.min(pw.length, new Set(pw).size * 2)
  return Math.round(eff * Math.log2(pool))
}

export async function createVault(master: string, cost: KdfCost = MASTER_COST): Promise<Session> {
  if (master.length < MIN_MASTER_LEN) throw new VaultError('weak')
  const id = newId()
  const kdf = newKdf(cost)
  const kek = await derive(master, kdf)
  const key = rand(32)
  const data: VaultData = { items: [] }
  const file: VaultFile = {
    v: 1, id, kdf,
    master: seal(kek, key, 'wrap-master', id),
    data: seal(key, enc.encode(JSON.stringify(data)), 'data', id),
  }
  wipe(kek)
  return { file, key, data }
}

function readData(file: VaultFile, key: Uint8Array): VaultData {
  const data = JSON.parse(dec.decode(open(key, file.data, 'data', file.id))) as VaultData
  if (!Array.isArray(data.items)) throw new VaultError('corrupt')
  return data
}

export async function unlockWithPassword(file: VaultFile, master: string): Promise<Session> {
  const kek = await derive(master, file.kdf)
  let key: Uint8Array
  try {
    key = open(kek, file.master, 'wrap-master', file.id)
  } catch {
    throw new VaultError('bad-password')
  } finally {
    wipe(kek)
  }
  return { file, key, data: readData(file, key) }
}

/** Re-encrypt current data with a fresh nonce; updates and returns the file. */
export function save(s: Session): VaultFile {
  s.file = { ...s.file, data: seal(s.key, enc.encode(JSON.stringify(s.data)), 'data', s.file.id) }
  return s.file
}

export async function changeMaster(s: Session, newMaster: string, cost: KdfCost = MASTER_COST): Promise<VaultFile> {
  if (newMaster.length < MIN_MASTER_LEN) throw new VaultError('weak')
  const kdf = newKdf(cost)
  const kek = await derive(newMaster, kdf)
  s.file = { ...s.file, kdf, master: seal(kek, s.key, 'wrap-master', s.file.id) }
  wipe(kek)
  return s.file
}

/** `device` = secret that never leaves this machine (OS-protected). Without it the PIN is only Argon2id-hard. */
const pinInput = (pin: string, device?: Uint8Array) => (device ? pin + '\u0000' + b64(device) : pin)

export async function setupPin(s: Session, pin: string, cost: KdfCost = PIN_COST, max = PIN_MAX_FAILS, device?: Uint8Array): Promise<VaultFile> {
  if (!/^\d{6,12}$/.test(pin)) throw new VaultError('weak', 'PIN must be 6-12 digits')
  const kdf = newKdf(cost)
  const kek = await derive(pinInput(pin, device), kdf)
  s.file = { ...s.file, pin: { kdf, wrap: seal(kek, s.key, 'wrap-pin', s.file.id), fails: 0, max, ...(device ? { dev: true } : {}) } }
  wipe(kek)
  return s.file
}

export function removePin(s: Session): VaultFile {
  const { pin: _p, ...rest } = s.file
  s.file = rest as VaultFile
  return s.file
}

export interface PinResult { file: VaultFile; session?: Session; remaining: number }

/**
 * Caller MUST persist result.file after every attempt (it carries the fail
 * counter). At `max` failures the PIN wrapper is destroyed and the master
 * password is required.
 */
export async function unlockWithPin(file: VaultFile, pin: string, device?: Uint8Array): Promise<PinResult> {
  const p = file.pin
  if (!p || (p.dev && !device)) throw new VaultError('no-pin')
  if (p.fails >= p.max) throw new VaultError('pin-locked')
  const kek = await derive(pinInput(pin, p.dev ? device : undefined), p.kdf)
  try {
    const key = open(kek, p.wrap, 'wrap-pin', file.id)
    const f: VaultFile = { ...file, pin: { ...p, fails: 0 } }
    return { file: f, session: { file: f, key, data: readData(f, key) }, remaining: p.max }
  } catch {
    const fails = p.fails + 1
    if (fails >= p.max) {
      const { pin: _x, ...rest } = file
      return { file: rest as VaultFile, remaining: 0 }
    }
    return { file: { ...file, pin: { ...p, fails } }, remaining: p.max - fails }
  } finally {
    wipe(kek)
  }
}

/** `secret` is the 32B secret from the authenticator (WebAuthn PRF). */
export function setupBiometric(s: Session, credId: string, salt: string, secret: Uint8Array): VaultFile {
  s.file = { ...s.file, bio: { credId, salt, wrap: seal(secret, s.key, 'wrap-bio', s.file.id) } }
  return s.file
}

export function removeBiometric(s: Session): VaultFile {
  const { bio: _b, ...rest } = s.file
  s.file = rest as VaultFile
  return s.file
}

export function unlockWithBiometric(file: VaultFile, secret: Uint8Array): Session {
  if (!file.bio) throw new VaultError('corrupt')
  const key = open(secret, file.bio.wrap, 'wrap-bio', file.id)
  return { file, key, data: readData(file, key) }
}

/** Encrypted backup = master-wrapped file only (no PIN/bio wrappers). */
export function exportBackup(s: Session): string {
  const { pin: _p, bio: _b, ...rest } = save(s)
  return JSON.stringify(rest)
}

export function parseBackup(text: string): VaultFile {
  const f = JSON.parse(text) as VaultFile
  if (f?.v !== 1 || !f.kdf || !f.master || !f.data) throw new VaultError('corrupt')
  return f
}

export function lock(s: Session): void {
  wipe(s.key)
  s.data = { items: [] }
}

/** Copy of the file safe to store in the cloud: master wrapper + data only. */
export function stripLocal(f: VaultFile): VaultFile {
  const { pin: _p, bio: _b, ...rest } = f
  return rest as VaultFile
}
