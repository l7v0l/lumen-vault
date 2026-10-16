import { describe, expect, it } from 'vitest'
import {
  createVault, unlockWithPassword, save, setupPin, unlockWithPin, changeMaster, exportBackup, parseBackup,
  setupBiometric, unlockWithBiometric, VaultError, estimateBits, newId, type VaultFile,
} from './vault'
import { generatePassword, defaultGen } from './generator'
import { rand } from './bytes'

const FAST = { m: 64, t: 1, p: 1 } // test-only cost
const PW = 'correct horse battery staple'

const item = () => ({ id: newId(), title: 'Mail', fav: false, created: 1, updated: 1, type: 'login' as const, username: 'a@b.c', password: 'x', url: '', notes: '' })

describe('vault', () => {
  it('rejects weak master password', async () => {
    await expect(createVault('short', FAST)).rejects.toMatchObject({ code: 'weak' })
  })

  it('round-trips data through password unlock', async () => {
    const s = await createVault(PW, FAST)
    s.data.items.push(item())
    const f = save(s)
    const s2 = await unlockWithPassword(JSON.parse(JSON.stringify(f)), PW)
    expect(s2.data.items[0].title).toBe('Mail')
  })

  it('wrong password fails', async () => {
    const s = await createVault(PW, FAST)
    await expect(unlockWithPassword(s.file, PW + 'x')).rejects.toMatchObject({ code: 'bad-password' })
  })

  it('file contains no plaintext', async () => {
    const s = await createVault(PW, FAST)
    s.data.items.push({ ...item(), title: 'SECRET-TITLE-123' })
    expect(JSON.stringify(save(s))).not.toContain('SECRET-TITLE-123')
  })

  it('uses a fresh nonce on every save', async () => {
    const s = await createVault(PW, FAST)
    const a = save(s).data.n
    const b = save(s).data.n
    expect(a).not.toBe(b)
  })

  it('detects tampering of ciphertext', async () => {
    const s = await createVault(PW, FAST)
    const f: VaultFile = JSON.parse(JSON.stringify(save(s)))
    const raw = atob(f.data.c)
    f.data.c = btoa(String.fromCharCode(raw.charCodeAt(0) ^ 1) + raw.slice(1))
    await expect(unlockWithPassword(f, PW)).rejects.toBeInstanceOf(VaultError)
  })

  it('binds blobs to vault id (AAD)', async () => {
    const a = await createVault(PW, FAST)
    const b = await createVault(PW, FAST)
    const mixed: VaultFile = { ...a.file, data: b.file.data }
    await expect(unlockWithPassword(mixed, PW)).rejects.toBeInstanceOf(VaultError)
  })

  it('changeMaster keeps data, invalidates old password', async () => {
    const s = await createVault(PW, FAST)
    s.data.items.push(item())
    save(s)
    const f = await changeMaster(s, 'another long passphrase', FAST)
    await expect(unlockWithPassword(f, PW)).rejects.toMatchObject({ code: 'bad-password' })
    expect((await unlockWithPassword(f, 'another long passphrase')).data.items).toHaveLength(1)
  })
})

describe('pin', () => {
  it('unlocks with right PIN and resets counter', async () => {
    const s = await createVault(PW, FAST)
    await setupPin(s, '123456', FAST)
    let r = await unlockWithPin(s.file, '000000')
    expect(r.session).toBeUndefined()
    expect(r.remaining).toBe(4)
    r = await unlockWithPin(r.file, '123456')
    expect(r.session).toBeDefined()
    expect(r.file.pin!.fails).toBe(0)
  })

  it('destroys PIN after max failures; password still works', async () => {
    const s = await createVault(PW, FAST)
    await setupPin(s, '123456', FAST, 3)
    let f = s.file
    for (let i = 0; i < 3; i++) f = (await unlockWithPin(f, '111111')).file
    expect(f.pin).toBeUndefined()
    await expect(unlockWithPin(f, '123456')).rejects.toMatchObject({ code: 'no-pin' })
    expect(await unlockWithPassword(f, PW)).toBeDefined()
  })

  it('device-bound PIN needs the device secret', async () => {
    const s = await createVault(PW, FAST)
    const dev = rand(32)
    await setupPin(s, '123456', FAST, 5, dev)
    expect(s.file.pin!.dev).toBe(true)
    await expect(unlockWithPin(s.file, '123456')).rejects.toMatchObject({ code: 'no-pin' })
    const bad = await unlockWithPin(s.file, '123456', rand(32))
    expect(bad.session).toBeUndefined()
    expect((await unlockWithPin(bad.file, '123456', dev)).session).toBeDefined()
  })

  it('rejects non-numeric / short PIN', async () => {
    const s = await createVault(PW, FAST)
    await expect(setupPin(s, '12ab56', FAST)).rejects.toBeInstanceOf(VaultError)
    await expect(setupPin(s, '1234', FAST)).rejects.toBeInstanceOf(VaultError)
  })
})

describe('biometric + backup', () => {
  it('unlocks with authenticator secret only', async () => {
    const s = await createVault(PW, FAST)
    s.data.items.push(item())
    save(s)
    const secret = rand(32)
    const f = setupBiometric(s, 'cred', 'salt', secret)
    expect(unlockWithBiometric(f, secret).data.items).toHaveLength(1)
    expect(() => unlockWithBiometric(f, rand(32))).toThrow()
  })

  it('backup strips PIN/bio wrappers and restores', async () => {
    const s = await createVault(PW, FAST)
    await setupPin(s, '123456', FAST)
    setupBiometric(s, 'c', 's', rand(32))
    s.data.items.push(item())
    const f = parseBackup(exportBackup(s))
    expect(f.pin).toBeUndefined()
    expect(f.bio).toBeUndefined()
    expect((await unlockWithPassword(f, PW)).data.items).toHaveLength(1)
  })
})

describe('generator / strength', () => {
  it('respects length and includes each class', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ ...defaultGen, length: 16 })
      expect(p).toHaveLength(16)
      expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/\d/); expect(p).toMatch(/[^A-Za-z0-9]/)
      expect(p).not.toMatch(/[Il1O0o]/)
    }
  })
  it('estimates bits sensibly', () => {
    expect(estimateBits('aaaaaaaaaa')).toBeLessThan(estimateBits('Xk9#mQ2$vL7!'))
  })
})
