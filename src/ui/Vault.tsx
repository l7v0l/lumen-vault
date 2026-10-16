import { useEffect, useMemo, useRef, useState } from 'react'
import { LANGS, useI18n, type Key } from '../i18n'
import {
  changeMaster, estimateBits, exportBackup, newId, parseBackup, removeBiometric, removePin, save, setupBiometric, setupPin,
  unlockWithPassword, VaultError, type CardItem, type Item, type Session, type VaultFile,
} from '../crypto/vault'
import { defaultGen, generatePassword, type GenOpts } from '../crypto/generator'
import { biometricAvailable, enrollBiometric } from '../crypto/webauthn'
import { copySecret, storeVault, type Prefs } from '../store'
import { Strength } from './Auth'
import { Bulb } from './Bulb'
import { CardVisual } from './CardVisual'
import { BANKS, NETWORKS, bankById, fmtExpiry, groupNumber, luhn } from './banks'

type Filter = 'all' | 'login' | 'card' | 'note' | 'fav'
type Draft = Item
type Sort = 'name' | 'recent'

const blank = (type: Item['type']): Draft => {
  const base = { id: newId(), title: '', fav: false, created: Date.now(), updated: Date.now() }
  if (type === 'login') return { ...base, type, username: '', password: '', url: '', notes: '' }
  if (type === 'card') return { ...base, type, holder: '', number: '', expiry: '', cvv: '', pin: '', bank: '', notes: '', style: 'snb', network: 'mada' }
  return { ...base, type: 'note', body: '' }
}

const icon = { login: '🔑', card: '💳', note: '📝' } as const
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }

function Avatar({ item, size = 40 }: { item: Item; size?: number }) {
  if (item.type === 'card') return <span className="av" style={{ width: size, height: size, background: `linear-gradient(135deg, ${bankById((item as CardItem).style).g.join(',')})` }}>💳</span>
  if (item.type === 'note') return <span className="av note" style={{ width: size, height: size }}>📝</span>
  const h = hue(item.title)
  return (
    <span className="av" style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 40) % 360} 75% 35%))` }}>
      {(item.title.trim()[0] || '?').toUpperCase()}
    </span>
  )
}

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
  const [sort, setSort] = useState<Sort>('name')
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

  useEffect(() => {
    if (!prefs.autoLockMin) return
    let id = window.setTimeout(onLock, prefs.autoLockMin * 60000)
    const reset = () => { window.clearTimeout(id); id = window.setTimeout(onLock, prefs.autoLockMin * 60000) }
    const evs = ['pointerdown', 'keydown', 'pointermove'] as const
    evs.forEach((e) => window.addEventListener(e, reset))
    return () => { window.clearTimeout(id); evs.forEach((e) => window.removeEventListener(e, reset)) }
  }, [prefs.autoLockMin, onLock])

  const counts = useMemo(() => ({
    all: items.length, fav: items.filter((i) => i.fav).length,
    login: items.filter((i) => i.type === 'login').length,
    card: items.filter((i) => i.type === 'card').length,
    note: items.filter((i) => i.type === 'note').length,
  }), [items])

  const health = useMemo(() => {
    const pws = items.filter((i) => i.type === 'login' && i.password).map((i) => (i as { password: string }).password)
    const weak = pws.filter((p) => estimateBits(p) < 50).length
    const seen = new Map<string, number>()
    pws.forEach((p) => seen.set(p, (seen.get(p) ?? 0) + 1))
    const reused = pws.filter((p) => (seen.get(p) ?? 0) > 1).length
    return { weak, reused }
  }, [items])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items
      .filter((i) => filter === 'all' || (filter === 'fav' ? i.fav : i.type === filter))
      .filter((i) => !s || i.title.toLowerCase().includes(s) || ('username' in i && i.username.toLowerCase().includes(s)) || ('url' in i && i.url.toLowerCase().includes(s)) || ('bank' in i && i.bank.toLowerCase().includes(s)))
      .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : b.updated - a.updated))
  }, [items, filter, q, sort])

  const current = items.find((i) => i.id === sel) ?? null

  const saveDraft = () => {
    if (!draft) return
    const d = { ...draft, title: draft.title.trim() || (draft.type === 'card' ? (draft as CardItem).bank : '') || '—', updated: Date.now() }
    commit(items.some((i) => i.id === d.id) ? items.map((i) => (i.id === d.id ? d : i)) : [...items, d])
    setSel(d.id); setDraft(null)
  }
  const remove = (id: string) => {
    if (!confirm(t('confirmDelete'))) return
    commit(items.filter((i) => i.id !== id)); setSel(null)
  }
  const startNew = (ty: Item['type']) => { setDraft(blank(ty)); setSel(null); setAddMenu(false) }
  const toggleSide = () => setPrefs({ ...prefs, side: !prefs.side })

  const nav: [Filter, Key, string][] = [
    ['all', 'all', '◈'], ['fav', 'favorites', '★'], ['login', 'logins', '🔑'], ['card', 'cards', '💳'], ['note', 'notes', '📝'],
  ]

  const showCards = filter === 'card'

  return (
    <div className={'app' + (sel || draft ? ' has-detail' : '') + (prefs.side ? '' : ' no-side')}>
      <aside className="side">
        <div className="side-inner">
          <div className="side-head"><Bulb lit size={30} /><b>Lumen</b></div>
          <nav>
            {nav.map(([id, k, ic]) => (
              <button key={id} className={filter === id ? 'on' : ''} onClick={() => { setFilter(id); setSel(null); setDraft(null) }}>
                <span>{ic}</span><em>{t(k)}</em><sup>{counts[id]}</sup>
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <button onClick={() => setModal('gen')}><span>⚡</span><em>{t('generator')}</em></button>
            <button onClick={() => setModal('settings')}><span>⚙</span><em>{t('settings')}</em></button>
            <button onClick={onLock}><span>🔒</span><em>{t('lockNow')}</em></button>
          </div>
        </div>
      </aside>

      <section className="list">
        <div className="list-head">
          <button className="icon-btn" onClick={toggleSide} title={prefs.side ? t('hideSide') : t('showSide')} aria-label={prefs.side ? t('hideSide') : t('showSide')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="add-wrap">
            <button className="fab" onClick={() => setAddMenu(!addMenu)} aria-label={t('add')}>+</button>
            {addMenu && (
              <div className="menu">
                {(['login', 'card', 'note'] as const).map((ty) => (
                  <button key={ty} onClick={() => startNew(ty)}>
                    {icon[ty]} {t(ty === 'login' ? 'newLogin' : ty === 'card' ? 'newCard' : 'newNote')}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sortbar">
          <span>{shown.length}</span>
          <div>
            <button className={sort === 'name' ? 'on' : ''} onClick={() => setSort('name')}>{t('sortName')}</button>
            <button className={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>{t('sortRecent')}</button>
          </div>
        </div>
        <div className={'items' + (showCards ? ' cards' : '')}>
          {shown.length === 0 && (
            <div className="empty"><Bulb lit={false} size={60} /><h3>{t('empty')}</h3><p>{t('emptySub')}</p></div>
          )}
          {shown.map((i, n) => showCards && i.type === 'card' ? (
            <div key={i.id} className={'card-tile rise' + (sel === i.id ? ' on' : '')} style={{ animationDelay: n * 50 + 'ms' }}>
              <CardVisual bank={i.bank} style={i.style} network={i.network} holder={i.holder} number={i.number} expiry={i.expiry} cvv={i.cvv} small onClick={() => { setSel(i.id); setDraft(null) }} />
            </div>
          ) : (
            <button key={i.id} style={{ animationDelay: n * 30 + 'ms' }} className={'item rise' + (sel === i.id ? ' on' : '')} onClick={() => { setSel(i.id); setDraft(null) }}>
              <Avatar item={i} />
              <span className="tx"><b>{i.title}</b><small>{i.type === 'login' ? i.username || i.url : i.type === 'card' ? '•••• ' + i.number.slice(-4) : i.body.slice(0, 40)}</small></span>
              {i.fav && <span className="star">★</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="detail">
        <button className="back" onClick={() => { setSel(null); setDraft(null) }}>‹</button>
        {draft ? (
          <Editor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => setDraft(null)} isNew={!items.some((i) => i.id === draft.id)} />
        ) : current ? (
          <Viewer item={current} onEdit={() => setDraft({ ...current })} onDelete={() => remove(current.id)}
            onFav={() => commit(items.map((i) => (i.id === current.id ? { ...i, fav: !i.fav } : i)))} flash={flash} />
        ) : (
          <Home counts={counts} health={health} onAdd={startNew} onFilter={(f) => setFilter(f)} />
        )}
      </section>

      {modal === 'gen' && <Generator onClose={() => setModal(null)} flash={flash} />}
      {modal === 'settings' && <Settings session={session} prefs={prefs} setPrefs={setPrefs} onFile={onFile} onClose={() => setModal(null)}
        onImported={(its) => { commit(its) }} flash={flash} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Home({ counts, health, onAdd, onFilter }: {
  counts: { login: number; card: number; note: number; fav: number }
  health: { weak: number; reused: number }
  onAdd: (t: Item['type']) => void
  onFilter: (f: Filter) => void
}) {
  const { t } = useI18n()
  const stats: [Filter, Key, number, string][] = [
    ['login', 'statLogins', counts.login, '🔑'], ['card', 'statCards', counts.card, '💳'], ['note', 'statNotes', counts.note, '📝'], ['fav', 'favorites', counts.fav, '★'],
  ]
  const ok = !health.weak && !health.reused
  return (
    <div className="home rise">
      <div className="home-hero">
        <div className="halo"><Bulb lit size={84} /></div>
        <h2>{t('hello')}</h2>
        <p>{t('homeSub')}</p>
      </div>
      <div className="stats">
        {stats.map(([f, k, n, ic], i) => (
          <button key={f} className="stat rise" style={{ animationDelay: i * 70 + 'ms' }} onClick={() => onFilter(f)}>
            <span>{ic}</span><b>{n}</b><small>{t(k)}</small>
          </button>
        ))}
      </div>
      <div className="healthbox">
        <h4>{t('health')}</h4>
        {ok ? <p className="good">✓ {t('allGood')}</p> : (
          <>
            {health.weak > 0 && <p className="bad">⚠ {t('weakPw')}: <b>{health.weak}</b></p>}
            {health.reused > 0 && <p className="bad">⚠ {t('reusedPw')}: <b>{health.reused}</b></p>}
          </>
        )}
      </div>
      <div className="quick">
        <small>{t('quickAdd')}</small>
        <div>
          <button className="btn" onClick={() => onAdd('login')}>🔑 {t('newLogin')}</button>
          <button className="btn" onClick={() => onAdd('card')}>💳 {t('newCard')}</button>
          <button className="btn" onClick={() => onAdd('note')}>📝 {t('newNote')}</button>
        </div>
      </div>
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
        <span className={mono ? 'mono' : ''} dir="auto">{secret && !show ? '•'.repeat(Math.min(value.length, 16)) : value}</span>
        {secret && <button className="mini" onClick={() => setShow(!show)}>{show ? t('hide') : t('show')}</button>}
        <button className="mini" onClick={() => copySecret(value).then(() => flash(t('copied')))}>{t('copy')}</button>
      </div>
    </div>
  )
}

function Viewer({ item, onEdit, onDelete, onFav, flash }: { item: Item; onEdit: () => void; onDelete: () => void; onFav: () => void; flash: (m: string) => void }) {
  const { t, lang } = useI18n()
  const [flip, setFlip] = useState(false)
  const [reveal, setReveal] = useState(false)
  useEffect(() => { setFlip(false); setReveal(false) }, [item.id])
  const url = item.type === 'login' && item.url ? (/^https?:\/\//.test(item.url) ? item.url : 'https://' + item.url) : ''
  const bits = item.type === 'login' ? estimateBits(item.password) : 0
  const date = new Date(item.updated).toLocaleDateString(lang === 'ar' ? 'ar-SA' : lang === 'zh' ? 'zh-CN' : 'en-GB')
  return (
    <div className="view rise" key={item.id}>
      <div className="view-head">
        <Avatar item={item} size={56} />
        <div className="vh-t"><h2>{item.title}</h2><small>{t('updatedAt')}: {date}</small></div>
        <button className={'mini star-btn' + (item.fav ? ' on' : '')} onClick={onFav}>★</button>
      </div>

      {item.type === 'card' && (
        <>
          <div className="card-stage">
            <CardVisual bank={item.bank} style={item.style} network={item.network} holder={item.holder} number={item.number} expiry={item.expiry} cvv={item.cvv} flipped={flip} reveal={reveal} onClick={() => setFlip(!flip)} />
          </div>
          <div className="card-ctl">
            <small>{t('flipHint')}</small>
            <button className="mini" onClick={() => setReveal(!reveal)}>{reveal ? t('hide') : t('show')}</button>
          </div>
          <Field label={t('cardNumber')} value={item.number.replace(/\D/g, '')} secret mono flash={flash} />
          <div className="two">
            <Field label={t('expiry')} value={item.expiry} flash={flash} />
            <Field label={t('cvv')} value={item.cvv} secret mono flash={flash} />
          </div>
          <Field label={t('pinF')} value={item.pin} secret mono flash={flash} />
          <Field label={t('holder')} value={item.holder} flash={flash} />
          <Field label={t('notesF')} value={item.notes} flash={flash} />
        </>
      )}

      {item.type === 'login' && (
        <>
          <Field label={t('username')} value={item.username} flash={flash} />
          <Field label={t('password')} value={item.password} secret mono flash={flash} />
          {item.password && (
            <div className="pwbar"><small>{t('pwStrength')}</small><Strength pw={item.password} /><small>{bits} bit</small></div>
          )}
          {url && <div className="field"><small>{t('url')}</small><div className="fv"><span dir="ltr">{item.url}</span><a className="mini" href={url} target="_blank" rel="noopener noreferrer">{t('openSite')} ↗</a></div></div>}
          <Field label={t('notesF')} value={item.notes} flash={flash} />
        </>
      )}

      {item.type === 'note' && <div className="paper"><p className="note-body" dir="auto">{item.body}</p></div>}

      <div className="actions">
        <button className="btn" onClick={onEdit}>{t('edit')}</button>
        <button className="btn danger" onClick={onDelete}>{t('delete')}</button>
      </div>
    </div>
  )
}

function Editor({ draft, setDraft, onSave, onCancel, isNew }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void; isNew: boolean }) {
  const { t, lang } = useI18n()
  const [flip, setFlip] = useState(false)
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v } as Draft)
  const val = (k: string) => (draft as unknown as Record<string, string>)[k] ?? ''
  const inp = (k: string, label: Key, opts: { area?: boolean; gen?: boolean; mono?: boolean; onChange?: (v: string) => string; onFocus?: () => void; onBlur?: () => void; inputMode?: 'numeric' } = {}) => (
    <label key={k}>{t(label)}
      {opts.area ? <textarea rows={opts.mono ? 3 : 6} dir="auto" value={val(k)} onChange={(e) => set(k, e.target.value)} /> : (
        <div className="row">
          <input dir="auto" inputMode={opts.inputMode} className={opts.mono ? 'mono' : ''} autoComplete="off" value={val(k)}
            onFocus={opts.onFocus} onBlur={opts.onBlur}
            onChange={(e) => set(k, opts.onChange ? opts.onChange(e.target.value) : e.target.value)} />
          {opts.gen && <button type="button" className="btn" onClick={() => set(k, generatePassword(defaultGen))}>{t('generate')}</button>}
        </div>
      )}
    </label>
  )

  const head = draft.type === 'login' ? (isNew ? 'newLogin' : 'editLogin') : draft.type === 'card' ? (isNew ? 'newCard' : 'editCard') : (isNew ? 'newNote' : 'editNote')

  return (
    <form className="edit rise" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <h2>{icon[draft.type]} {t(head)}</h2>

      {draft.type === 'card' && (
        <>
          <div className="card-stage">
            <CardVisual bank={draft.bank} style={draft.style} network={draft.network} holder={draft.holder} number={draft.number} expiry={draft.expiry} cvv={draft.cvv} flipped={flip} reveal onClick={() => setFlip(!flip)} />
          </div>
          <div className="pick">
            <small>{t('bankPick')}</small>
            <div className="swatches">
              {BANKS.map((b) => (
                <button type="button" key={b.id} className={'sw' + (draft.style === b.id ? ' on' : '')} onClick={() => setDraft({ ...draft, style: b.id, bank: b.name[lang] } as Draft)}>
                  <i style={{ background: `linear-gradient(135deg, ${b.g[0]}, ${b.g[1]})` }} />
                  <span>{b.name[lang]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="pick">
            <small>{t('network')}</small>
            <div className="nets">
              {NETWORKS.map((n) => (
                <button type="button" key={n.id} className={draft.network === n.id ? 'on' : ''} onClick={() => setDraft({ ...draft, network: n.id } as Draft)}>{n.label}</button>
              ))}
            </div>
          </div>
          {inp('bank', 'bank')}
          {inp('holder', 'holder')}
          <label>{t('cardNumber')}
            <input className="mono" dir="ltr" inputMode="numeric" autoComplete="off" value={groupNumber(draft.number)} onFocus={() => setFlip(false)}
              onChange={(e) => set('number', groupNumber(e.target.value))} />
            {draft.number.replace(/\D/g, '').length >= 12 && (
              <em className={'chint ' + (luhn(draft.number) ? 'ok' : 'bad')}>{luhn(draft.number) ? '✓ ' + t('cardOk') : '⚠ ' + t('cardBad')}</em>
            )}
          </label>
          <div className="two">
            {inp('expiry', 'expiry', { mono: true, inputMode: 'numeric', onChange: fmtExpiry, onFocus: () => setFlip(false) })}
            {inp('cvv', 'cvv', { mono: true, inputMode: 'numeric', onChange: (v) => v.replace(/\D/g, '').slice(0, 4), onFocus: () => setFlip(true), onBlur: () => setFlip(false) })}
          </div>
          {inp('pin', 'pinF', { mono: true, inputMode: 'numeric', onChange: (v) => v.replace(/\D/g, '').slice(0, 8) })}
          {inp('title', 'title')}
          {inp('notes', 'notesF', { area: true })}
        </>
      )}

      {draft.type === 'login' && (
        <>
          {inp('title', 'title')}
          {inp('username', 'username')}
          {inp('password', 'password', { mono: true, gen: true })}
          <Strength pw={draft.password} />
          {inp('url', 'url')}
          {inp('notes', 'notesF', { area: true })}
        </>
      )}

      {draft.type === 'note' && <>{inp('title', 'noteTitleHint')}{inp('body', 'body', { area: true })}</>}

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
