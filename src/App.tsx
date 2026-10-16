import { useCallback, useEffect, useMemo, useState } from 'react'
import { I18nCtx, isRtl, makeT, type Lang } from './i18n'
import { lock, type Session, type VaultFile } from './crypto/vault'
import { loadPrefs, loadVault, storePrefs, type Prefs } from './store'
import { Intro } from './ui/Intro'
import { Create, QuickSetup, Unlock } from './ui/Auth'
import { Vault } from './ui/Vault'

type Stage = 'intro' | 'auth' | 'quick' | 'vault'

export default function App() {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [stage, setStage] = useState<Stage>('intro')
  const [file, setFile] = useState<VaultFile | null>(loadVault)
  const [session, setSession] = useState<Session | null>(null)

  const setPrefs = (p: Prefs) => { setPrefsState(p); storePrefs(p) }
  const setLang = (lang: Lang) => setPrefs({ ...prefs, lang })
  const i18n = useMemo(() => ({ lang: prefs.lang, t: makeT(prefs.lang), setLang }), [prefs]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.lang = prefs.lang
    document.documentElement.dir = isRtl(prefs.lang) ? 'rtl' : 'ltr'
  }, [prefs.lang])

  const doLock = useCallback(() => {
    setSession((s) => { if (s) lock(s); return null })
    setFile(loadVault())
    setStage('auth')
  }, [])

  const introDone = () => { setPrefs({ ...prefs, introSeen: true }); setStage('auth') }

  return (
    <I18nCtx.Provider value={i18n}>
      {stage === 'intro' && <Intro onDone={introDone} />}
      {stage === 'auth' && (
        <div className="fade-in">
          {file
            ? <Unlock file={file} onFile={setFile} onUnlocked={(s) => { setSession(s); setStage('vault') }} />
            : <Create onCreated={(s) => { setSession(s); setFile(s.file); setStage('quick') }} />}
        </div>
      )}
      {stage === 'quick' && session && <QuickSetup session={session} onDone={() => setStage('vault')} />}
      {stage === 'vault' && session && (
        <div className="fade-in">
          <Vault session={session} prefs={prefs} setPrefs={setPrefs} onLock={doLock} onFile={setFile} />
        </div>
      )}
    </I18nCtx.Provider>
  )
}
