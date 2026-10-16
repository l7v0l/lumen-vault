import { useEffect, useState } from 'react'
import { LANGS, useI18n } from '../i18n'
import {
  createVault, estimateBits, setupBiometric, setupPin, unlockWithBiometric, unlockWithPassword, unlockWithPin,
  VaultError, MIN_MASTER_LEN, parseBackup, type Session, type VaultFile,
} from '../crypto/vault'
import { biometricAvailable, enrollBiometric, getSecret } from '../crypto/webauthn'
import { storeVault } from '../store'
import { deviceSecret } from '../device'
import { availableProviders, connect, pull, push, type Provider } from '../cloud'
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

function GIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.3-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-4z"/></svg>
  )
}
function MIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/><path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/></svg>
  )
}

export function Social({ onPulled }: { onPulled: (f: VaultFile) => void }) {
  const { t } = useI18n()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<Provider | null>(null)
  const avail = availableProviders()
  if (!avail.length) return null
  const go = async (p: Provider) => {
    setBusy(p); setMsg('')
    try {
      await connect(p)
      const text = await pull()
      if (text) { const f = parseBackup(text); storeVault(f); onPulled(f) } else setMsg(t('cloudNone'))
    } catch (e) { setMsg(t('cloudFail') + ' (' + ((e as Error).message || 'error') + ')') }
    setBusy(null)
  }
  return (
    <>
      <div className="social">
        {avail.includes('google') && <button className="btn sbtn" disabled={!!busy} onClick={() => go('google')}><GIcon />{t('google')}</button>}
        {avail.includes('microsoft') && <button className="btn sbtn" disabled={!!busy} onClick={() => go('microsoft')}><MIcon />{t('microsoft')}</button>}
      </div>
      {msg && <p className="sub small">{msg}</p>}
      <div className="or"><span>{t('orSep')}</span></div>
    </>
  )
}

export function Create({ onCreated, onPulled }: { onCreated: (s: Session) => void; onPulled: (f: VaultFile) => void }) {
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
    push(s.file).catch(() => {})
    onCreated(s)
  }

  return (
    <Shell>
      <h2>{t('createTitle')}</h2>
      <p className="sub">{t('createSub')}</p>
      <Social onPulled={onPulled} />
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
    try { storeVault(await setupPin(session, pin, undefined, undefined, await deviceSecret())); setPinOn(true); setPin('') } catch { setMsg(t('setPin')) }
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
      const r = await unlockWithPin(file, p, await deviceSecret())
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
