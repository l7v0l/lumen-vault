import { useEffect, useState } from 'react'
import { LANGS, useI18n } from '../i18n'
import {
  createVault, estimateBits, setupBiometric, setupPin, unlockWithBiometric, unlockWithPassword, unlockWithPin,
  VaultError, MIN_MASTER_LEN, type Session, type VaultFile,
} from '../crypto/vault'
import { biometricAvailable, enrollBiometric, getSecret } from '../crypto/webauthn'
import { storeVault } from '../store'
import { Bulb } from './Bulb'

export function LangSwitch() {
  const { lang, setLang } = useI18n()
  return (
    <div className="langs">
      {LANGS.map((l) => (
        <button key={l.id} className={l.id === lang ? 'on' : ''} onClick={() => setLang(l.id)}>{l.label}</button>
      ))}
    </div>
  )
}

export function Strength({ pw }: { pw: string }) {
  const { t } = useI18n()
  const bits = estimateBits(pw)
  const lvl = !pw ? 0 : bits < 50 ? 1 : bits < 75 ? 2 : 3
  return (
    <div className={'strength s' + lvl}>
      <i /><i /><i />
      <span>{lvl === 1 ? t('weak') : lvl === 2 ? t('fair') : lvl === 3 ? t('strong') : ''}</span>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="auth">
      <LangSwitch />
      <div className="card auth-card rise">
        <div className="logo"><Bulb lit size={64} /></div>
        {children}
      </div>
    </div>
  )
}

export function Create({ onCreated }: { onCreated: (s: Session) => void }) {
  const { t } = useI18n()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const err = pw && pw.length < MIN_MASTER_LEN ? t('tooShort') : pw2 && pw !== pw2 ? t('mismatch') : ''
  const ok = pw.length >= MIN_MASTER_LEN && pw === pw2

  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    const s = await createVault(pw)
    storeVault(s.file)
    onCreated(s)
  }

  return (
    <Shell>
      <h2>{t('createTitle')}</h2>
      <p className="sub">{t('createSub')}</p>
      <form onSubmit={go}>
        <label>{t('master')}
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        <Strength pw={pw} />
        <label>{t('masterConfirm')}
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={!ok || busy}>{busy ? '…' : t('create')}</button>
      </form>
    </Shell>
  )
}

export function QuickSetup({ session, onDone }: { session: Session; onDone: () => void }) {
  const { t } = useI18n()
  const [pin, setPin] = useState('')
  const [pinOn, setPinOn] = useState(false)
  const [bioOn, setBioOn] = useState(false)
  const [bioOk, setBioOk] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { biometricAvailable().then(setBioOk) }, [])

  const doPin = async () => {
    setBusy(true)
    try { storeVault(await setupPin(session, pin)); setPinOn(true); setPin('') } catch { setMsg(t('setPin')) }
    setBusy(false)
  }
  const doBio = async () => {
    setMsg('')
    try {
      const { credId, salt, secret } = await enrollBiometric()
      storeVault(setupBiometric(session, credId, salt, secret))
      setBioOn(true)
    } catch (e) {
      setMsg((e as Error).message === 'prf-unsupported' ? t('bioUnsupported') : t('bioFailed'))
    }
  }

  return (
    <Shell>
      <h2>{t('quickTitle')}</h2>
      <p className="sub">{t('quickSub')}</p>
      <label>{t('setPin')}
        <div className="row">
          <input inputMode="numeric" type="password" value={pin} maxLength={12} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} disabled={pinOn} />
          <button className="btn" disabled={busy || pinOn || pin.length < 6} onClick={doPin}>{pinOn ? '✓' : t('save')}</button>
        </div>
      </label>
      <button className="btn" disabled={!bioOk || bioOn} onClick={doBio}>{bioOn ? '✓ ' : ''}{t('enableBio')}</button>
      {!bioOk && <p className="sub small">{t('bioUnsupported')}</p>}
      {msg && <p className="err">{msg}</p>}
      <button className="btn primary" onClick={onDone}>{pinOn || bioOn ? t('done') : t('later')}</button>
    </Shell>
  )
}

export function Unlock({ file, onFile, onUnlocked }: {
  file: VaultFile
  onFile: (f: VaultFile) => void
  onUnlocked: (s: Session) => void
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'pin' | 'pw'>(file.pin ? 'pin' : 'pw')
  const [pw, setPw] = useState('')
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)

  useEffect(() => { if (!file.pin && mode === 'pin') setMode('pw') }, [file.pin, mode])

  const fail = (m: string) => { setMsg(m); setShake((n) => n + 1) }

  const byPw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true); setMsg('')
    try { onUnlocked(await unlockWithPassword(file, pw)) }
    catch (er) { fail(er instanceof VaultError && er.code === 'bad-password' ? t('wrongPassword') : t('corrupt')); setBusy(false) }
  }

  const byPin = async (p: string) => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = await unlockWithPin(file, p)
      storeVault(r.file); onFile(r.file)
      if (r.session) onUnlocked(r.session)
      else {
        fail(r.remaining ? t('pinLeft') + r.remaining : t('pinWiped'))
        if (!r.remaining) setMode('pw')
        setPin(''); setBusy(false)
      }
    } catch { fail(t('corrupt')); setBusy(false) }
  }

  const byBio = async () => {
    if (!file.bio) return
    setMsg('')
    try { onUnlocked(unlockWithBiometric(file, await getSecret(file.bio.credId, file.bio.salt))) }
    catch { fail(t('bioFailed')) }
  }

  const press = (d: string) => {
    if (busy) return
    const n = (pin + d).slice(0, 12)
    setPin(n)
  }

  return (
    <Shell>
      <h2>{t('unlockTitle')}</h2>
      <div key={shake} className={shake ? 'shake' : ''}>
        {mode === 'pin' && file.pin ? (
          <>
            <div className="dots">{Array.from({ length: Math.max(6, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'f' : ''} />)}</div>
            <div className="pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '⏎'].map((k) => (
                <button key={k} className="key" disabled={busy}
                  onClick={() => k === '⌫' ? setPin(pin.slice(0, -1)) : k === '⏎' ? pin.length >= 6 && byPin(pin) : press(k)}>{k}</button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={byPw}>
            <label>{t('master')}
              <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </label>
            <button className="btn primary" disabled={!pw || busy}>{busy ? '…' : t('unlock')}</button>
          </form>
        )}
      </div>
      {msg && <p className="err">{msg}</p>}
      <div className="alt">
        {file.bio && <button className="link" onClick={byBio}>{t('useBio')}</button>}
        {file.pin && <button className="link" onClick={() => { setMode(mode === 'pin' ? 'pw' : 'pin'); setMsg('') }}>{mode === 'pin' ? t('usePassword') : t('usePin')}</button>}
      </div>
    </Shell>
  )
}
