import { useEffect, useMemo, useRef, useState } from 'react'
import { LANGS, useI18n, type Key } from '../i18n'
import {
  changeMaster, exportBackup, newId, parseBackup, removeBiometric, removePin, save, setupBiometric, setupPin,
  unlockWithPassword, VaultError, type Item, type Session, type VaultFile,
} from '../crypto/vault'
import { defaultGen, generatePassword, type GenOpts } from '../crypto/generator'
import { biometricAvailable, enrollBiometric } from '../crypto/webauthn'
import { copySecret, storeVault, type Prefs } from '../store'
import { Strength } from './Auth'
import { Bulb } from './Bulb'

type Filter = 'all' | 'login' | 'card' | 'note' | 'fav'
type Draft = Item

const blank = (type: Item['type']): Draft => {
  const base = { id: newId(), title: '', fav: false, created: Date.now(), updated: Date.now() }
  if (type === 'login') return { ...base, type, username: '', password: '', url: '', notes: '' }
  if (type === 'card') return { ...base, type, holder: '', number: '', expiry: '', cvv: '', pin: '', bank: '', notes: '' }
  return { ...base, type: 'note', body: '' }
}

const icon = { login: '🔑', card: '💳', note: '📝' } as const

export function Vault({ session, prefs, setPrefs, onLock, onFile }: {
  session: Session
  prefs: Prefs
  setPrefs: (p: Prefs) => void
  onLock: () => void
  onFile: (f: VaultFile) => void
}) {
  const { t } = useI18n()
  const [items, setItems] = useState<Item[]>(session.data.items)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [modal, setModal] = useState<'settings' | 'gen' | null>(null)
  const [addMenu, setAddMenu] = useState(false)
  const [toast, setToast] = useState('')

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 2200) }

  const commit = (next: Item[]) => {
    session.data.items = next
    const f = save(session)
    storeVault(f); onFile(f)
    setItems(next)
  }

  // idle auto-lock
  useEffect(() => {
    if (!prefs.autoLockMin) return
    let id = window.setTimeout(onLock, prefs.autoLockMin * 60000)
    const reset = () => { window.clearTimeout(id); id = window.setTimeout(onLock, prefs.autoLockMin * 60000) }
    const evs = ['pointerdown', 'keydown', 'pointermove'] as const
    evs.forEach((e) => window.addEventListener(e, reset))
    return () => { window.clearTimeout(id); evs.forEach((e) => window.removeEventListener(e, reset)) }
  }, [prefs.autoLockMin, onLock])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items
      .filter((i) => filter === 'all' || (filter === 'fav' ? i.fav : i.type === filter))
      .filter((i) => !s || i.title.toLowerCase().includes(s) || ('username' in i && i.username.toLowerCase().includes(s)) || ('url' in i && i.url.toLowerCase().includes(s)))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [items, filter, q])

  const current = items.find((i) => i.id === sel) ?? null

  const saveDraft = () => {
    if (!draft) return
    const d = { ...draft, title: draft.title.trim() || '—', updated: Date.now() }
    commit(items.some((i) => i.id === d.id) ? items.map((i) => (i.id === d.id ? d : i)) : [...items, d])
    setSel(d.id); setDraft(null)
  }
  const remove = (id: string) => {
    if (!confirm(t('confirmDelete'))) return
    commit(items.filter((i) => i.id !== id)); setSel(null)
  }

  const nav: [Filter, Key, string][] = [
    ['all', 'all', '◈'], ['fav', 'favorites', '★'], ['login', 'logins', '🔑'], ['card', 'cards', '💳'], ['note', 'notes', '📝'],
  ]

  return (
    <div className={'app' + (sel || draft ? ' has-detail' : '')}>
      <aside className="side">
        <div className="side-head"><Bulb lit size={30} /><b>Lumen</b></div>
        <nav>
          {nav.map(([id, k, ic]) => (
            <button key={id} className={filter === id ? 'on' : ''} onClick={() => { setFilter(id); setSel(null); setDraft(null) }}>
              <span>{ic}</span>{t(k)}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button onClick={() => setModal('gen')}><span>⚡</span>{t('generator')}</button>
          <button onClick={() => setModal('settings')}><span>⚙</span>{t('settings')}</button>
          <button onClick={onLock}><span>🔒</span>{t('lockNow')}</button>
        </div>
      </aside>

      <section className="list">
        <div className="list-head">
          <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="add-wrap">
            <button className="fab" onClick={() => setAddMenu(!addMenu)} aria-label={t('add')}>+</button>
            {addMenu && (
              <div className="menu">
                {(['login', 'card', 'note'] as const).map((ty) => (
                  <button key={ty} onClick={() => { setDraft(blank(ty)); setSel(null); setAddMenu(false) }}>
                    {icon[ty]} {t(ty === 'login' ? 'newLogin' : ty === 'card' ? 'newCard' : 'newNote')}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="items">
          {shown.length === 0 && (
            <div className="empty"><Bulb lit={false} size={60} /><h3>{t('empty')}</h3><p>{t('emptySub')}</p></div>
          )}
          {shown.map((i, n) => (
            <button key={i.id} style={{ animationDelay: n * 30 + 'ms' }} className={'item rise' + (sel === i.id ? ' on' : '')} onClick={() => { setSel(i.id); setDraft(null) }}>
              <span className="ic">{icon[i.type]}</span>
              <span className="tx"><b>{i.title}</b><small>{i.type === 'login' ? i.username : i.type === 'card' ? '•••• ' + i.number.slice(-4) : ''}</small></span>
              {i.fav && <span className="star">★</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="detail">
        <button className="back" onClick={() => { setSel(null); setDraft(null) }}>‹</button>
        {draft ? (
          <Editor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => setDraft(null)} />
        ) : current ? (
          <Viewer item={current} onEdit={() => setDraft({ ...current })} onDelete={() => remove(current.id)}
            onFav={() => commit(items.map((i) => (i.id === current.id ? { ...i, fav: !i.fav } : i)))} flash={flash} />
        ) : (
          <div className="empty big"><Bulb lit size={90} /><p>{t('tagline')}</p></div>
        )}
      </section>

      {modal === 'gen' && <Generator onClose={() => setModal(null)} flash={flash} />}
      {modal === 'settings' && <Settings session={session} prefs={prefs} setPrefs={setPrefs} onFile={onFile} onClose={() => setModal(null)}
        onImported={(its) => { commit(its); }} flash={flash} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Field({ label, value, secret, flash, mono }: { label: string; value: string; secret?: boolean; flash: (m: string) => void; mono?: boolean }) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  if (!value) return null
  return (
    <div className="field">
      <small>{label}</small>
      <div className="fv">
        <span className={mono ? 'mono' : ''} dir="ltr">{secret && !show ? '•'.repeat(Math.min(value.length, 16)) : value}</span>
        {secret && <button className="mini" onClick={() => setShow(!show)}>{show ? t('hide') : t('show')}</button>}
        <button className="mini" onClick={() => copySecret(value).then(() => flash(t('copied')))}>{t('copy')}</button>
      </div>
    </div>
  )
}

function Viewer({ item, onEdit, onDelete, onFav, flash }: { item: Item; onEdit: () => void; onDelete: () => void; onFav: () => void; flash: (m: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="view rise" key={item.id}>
      <div className="view-head">
        <span className="ic big">{icon[item.type]}</span>
        <h2>{item.title}</h2>
        <button className={'mini star-btn' + (item.fav ? ' on' : '')} onClick={onFav}>★</button>
      </div>
      {item.type === 'login' && <>
        <Field label={t('username')} value={item.username} flash={flash} />
        <Field label={t('password')} value={item.password} secret mono flash={flash} />
        <Field label={t('url')} value={item.url} flash={flash} />
        <Field label={t('notesF')} value={item.notes} flash={flash} />
      </>}
      {item.type === 'card' && <>
        <Field label={t('bank')} value={item.bank} flash={flash} />
        <Field label={t('holder')} value={item.holder} flash={flash} />
        <Field label={t('cardNumber')} value={item.number} secret mono flash={flash} />
        <Field label={t('expiry')} value={item.expiry} flash={flash} />
        <Field label={t('cvv')} value={item.cvv} secret mono flash={flash} />
        <Field label={t('pinF')} value={item.pin} secret mono flash={flash} />
        <Field label={t('notesF')} value={item.notes} flash={flash} />
      </>}
      {item.type === 'note' && <div className="field"><small>{t('body')}</small><p className="note-body">{item.body}</p></div>}
      <div className="actions">
        <button className="btn" onClick={onEdit}>{t('edit')}</button>
        <button className="btn danger" onClick={onDelete}>{t('delete')}</button>
      </div>
    </div>
  )
}

function Editor({ draft, setDraft, onSave, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const { t } = useI18n()
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v } as Draft)
  const inp = (k: string, label: Key, opts: { secret?: boolean; area?: boolean; gen?: boolean } = {}) => {
    const v = (draft as unknown as Record<string, string>)[k] ?? ''
    return (
      <label key={k}>{t(label)}
        {opts.area ? <textarea rows={5} value={v} onChange={(e) => set(k, e.target.value)} /> : (
          <div className="row">
            <input dir="auto" type={opts.secret ? 'text' : 'text'} className={opts.secret ? 'mono' : ''} autoComplete="off" value={v} onChange={(e) => set(k, e.target.value)} />
            {opts.gen && <button type="button" className="btn" onClick={() => set(k, generatePassword(defaultGen))}>{t('generate')}</button>}
          </div>
        )}
      </label>
    )
  }
  return (
    <form className="edit rise" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <h2>{icon[draft.type]} {t(draft.type === 'login' ? 'newLogin' : draft.type === 'card' ? 'newCard' : 'newNote')}</h2>
      {inp('title', 'title')}
      {draft.type === 'login' && <>{inp('username', 'username')}{inp('password', 'password', { secret: true, gen: true })}<Strength pw={draft.password} />{inp('url', 'url')}{inp('notes', 'notesF', { area: true })}</>}
      {draft.type === 'card' && <>{inp('bank', 'bank')}{inp('holder', 'holder')}{inp('number', 'cardNumber', { secret: true })}{inp('expiry', 'expiry')}{inp('cvv', 'cvv', { secret: true })}{inp('pin', 'pinF', { secret: true })}{inp('notes', 'notesF', { area: true })}</>}
      {draft.type === 'note' && inp('body', 'body', { area: true })}
      <div className="actions">
        <button className="btn primary">{t('save')}</button>
        <button type="button" className="btn" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </form>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal rise" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>{title}</h3><button className="mini" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  )
}

function Generator({ onClose, flash }: { onClose: () => void; flash: (m: string) => void }) {
  const { t } = useI18n()
  const [o, setO] = useState<GenOpts>(defaultGen)
  const [pw, setPw] = useState(() => generatePassword(defaultGen))
  const regen = (n: GenOpts) => { setO(n); setPw(generatePassword(n)) }
  const tog = (k: 'lower' | 'upper' | 'digits' | 'symbols' | 'avoidAmbiguous', lbl: Key) => (
    <label className="chk"><input type="checkbox" checked={o[k]} onChange={(e) => regen({ ...o, [k]: e.target.checked })} />{t(lbl)}</label>
  )
  return (
    <Modal title={t('generator')} onClose={onClose}>
      <div className="genout mono" dir="ltr">{pw}</div>
      <Strength pw={pw} />
      <label>{t('len')}: {o.length}
        <input type="range" min={8} max={64} value={o.length} onChange={(e) => regen({ ...o, length: +e.target.value })} />
      </label>
      <div className="chks">{tog('lower', 'lower')}{tog('upper', 'upper')}{tog('digits', 'digits')}{tog('symbols', 'symbols')}{tog('avoidAmbiguous', 'ambiguous')}</div>
      <div className="actions">
        <button className="btn" onClick={() => setPw(generatePassword(o))}>{t('regenerate')}</button>
        <button className="btn primary" onClick={() => copySecret(pw).then(() => flash(t('copied')))}>{t('copy')}</button>
      </div>
    </Modal>
  )
}

function Settings({ session, prefs, setPrefs, onFile, onClose, onImported, flash }: {
  session: Session; prefs: Prefs; setPrefs: (p: Prefs) => void; onFile: (f: VaultFile) => void
  onClose: () => void; onImported: (items: Item[]) => void; flash: (m: string) => void
}) {
  const { t, lang, setLang } = useI18n()
  const [bioOk, setBioOk] = useState(false)
  const [, bump] = useState(0)
  const [pin, setPin] = useState('')
  const [newPw, setNewPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { biometricAvailable().then(setBioOk) }, [])

  const persist = (f: VaultFile) => { storeVault(f); onFile(f); bump((n) => n + 1) }
  const f = session.file

  const doPin = async () => { setBusy(true); try { persist(await setupPin(session, pin)); setPin(''); flash(t('saved')) } catch { setErr(t('setPin')) } setBusy(false) }
  const doBio = async () => {
    setErr('')
    try { const r = await enrollBiometric(); persist(setupBiometric(session, r.credId, r.salt, r.secret)) }
    catch (e) { setErr((e as Error).message === 'prf-unsupported' ? t('bioUnsupported') : t('bioFailed')) }
  }
  const doMaster = async () => { setBusy(true); try { persist(await changeMaster(session, newPw)); setNewPw(''); flash(t('saved')) } catch { setErr(t('tooShort')) } setBusy(false) }
  const doExport = () => {
    const blob = new Blob([exportBackup(session)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lumen-backup-${new Date().toISOString().slice(0, 10)}.lumen`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const doImport = async (file: File) => {
    const pw = prompt(t('importWarn'))
    if (!pw) return
    setBusy(true)
    try {
      const imp = await unlockWithPassword(parseBackup(await file.text()), pw)
      const have = new Set(session.data.items.map((i) => i.id))
      const fresh = imp.data.items.filter((i) => !have.has(i.id))
      onImported([...session.data.items, ...fresh])
      flash(t('importDone') + fresh.length)
    } catch (e) { setErr(e instanceof VaultError && e.code === 'bad-password' ? t('wrongPassword') : t('corrupt')) }
    setBusy(false)
  }

  return (
    <Modal title={t('settings')} onClose={onClose}>
      <div className="set">
        <label>{t('language')}
          <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>{LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
        </label>
        <label>{t('autoLock')}
          <select value={prefs.autoLockMin} onChange={(e) => setPrefs({ ...prefs, autoLockMin: +e.target.value })}>
            {[1, 2, 5, 15, 30].map((m) => <option key={m} value={m}>{m} {t('minutes')}</option>)}
            <option value={0}>{t('never')}</option>
          </select>
        </label>
        <hr />
        <label>PIN · {f.pin ? t('on') : t('off')}
          <div className="row">
            <input type="password" inputMode="numeric" maxLength={12} placeholder={t('setPin')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn" disabled={busy || pin.length < 6} onClick={doPin}>{t('save')}</button>
          </div>
        </label>
        {f.pin && <button className="btn" onClick={() => persist(removePin(session))}>{t('pinRemove')}</button>}
        <div className="row">
          {f.bio
            ? <button className="btn" onClick={() => persist(removeBiometric(session))}>{t('bioRemove')}</button>
            : <button className="btn" disabled={!bioOk} onClick={doBio}>{t('bioSetup')}</button>}
        </div>
        {!bioOk && <small className="sub">{t('bioUnsupported')}</small>}
        <hr />
        <label>{t('changeMaster')}
          <div className="row">
            <input type="password" autoComplete="new-password" placeholder={t('newMaster')} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <button className="btn" disabled={busy || newPw.length < 10} onClick={doMaster}>{t('save')}</button>
          </div>
        </label>
        <Strength pw={newPw} />
        <hr />
        <div className="row">
          <button className="btn" onClick={doExport}>{t('export')}</button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{t('import')}</button>
          <input ref={fileRef} type="file" hidden accept=".lumen,application/json" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) doImport(fl); e.target.value = '' }} />
        </div>
        {err && <p className="err">{err}</p>}
      </div>
    </Modal>
  )
}
