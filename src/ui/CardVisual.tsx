import { useRef } from 'react'
import { useI18n } from '../i18n'
import { bankById, groupNumber } from './banks'

interface Props {
  bank: string; style?: string; network?: string; holder: string; number: string; expiry: string; cvv: string
  flipped?: boolean; reveal?: boolean; small?: boolean; onClick?: () => void
}

function Network({ id }: { id?: string }) {
  if (id === 'mastercard') return <span className="net mc"><i /><i /></span>
  if (id === 'visa') return <span className="net visa">VISA</span>
  if (id === 'mada') return <span className="net mada">mada</span>
  return <span className="net" />
}

export function CardVisual(p: Props) {
  const { lang, t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const st = bankById(p.style)
  const name = p.bank || st.name[lang]
  const digits = p.number.replace(/\D/g, '')
  const shown = p.reveal ? groupNumber(digits) : digits ? '•••• •••• •••• ' + (digits.slice(-4) || '••••') : ''
  const placeholder = '•••• •••• •••• ••••'

  const move = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el || p.small) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', x * 14 + 'deg')
    el.style.setProperty('--rx', -y * 14 + 'deg')
    el.style.setProperty('--gx', (x + 0.5) * 100 + '%')
  }
  const leave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--ry', '0deg'); el.style.setProperty('--rx', '0deg')
  }

  const bg = { background: `linear-gradient(135deg, ${st.g[0]}, ${st.g[1]})` }

  return (
    <div ref={ref} className={'cv' + (p.small ? ' small' : '') + (p.flipped ? ' flipped' : '')} dir="ltr"
      onMouseMove={move} onMouseLeave={leave} onClick={p.onClick}>
      <div className="cv-in">
        <div className="cv-face front" style={bg}>
          <div className="cv-sheen" />
          <div className="cv-top">
            <b className="cv-bank">{name}</b>
            <svg className="nfc" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity=".85">
              <path d="M7 8c2 2.5 2 5.5 0 8M11 6c3 3.5 3 8.5 0 12M15 4c4 4.5 4 11.5 0 16" />
            </svg>
          </div>
          <svg className="chip" width="46" height="36" viewBox="0 0 46 36">
            <rect width="46" height="36" rx="7" fill="#e8c775" /><rect width="46" height="36" rx="7" fill="url(#chipg)" opacity=".5" />
            <path d="M0 12h46M0 24h46M16 0v36M30 0v36" stroke="#a17c26" strokeWidth="1.2" opacity=".7" />
            <defs><linearGradient id="chipg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#c99a2e" /></linearGradient></defs>
          </svg>
          <div className="cv-num mono">{shown || placeholder}</div>
          <div className="cv-bot">
            <div><small>CARD HOLDER</small><span>{(p.holder || 'YOUR NAME').toUpperCase()}</span></div>
            <div><small>VALID THRU</small><span>{p.expiry || 'MM/YY'}</span></div>
            <Network id={p.network} />
          </div>
        </div>
        <div className="cv-face back" style={bg}>
          <div className="stripe" />
          <div className="sig"><span>{t('cvv')}</span><b className="mono">{p.reveal ? p.cvv || '•••' : p.cvv ? '•••' : '•••'}</b></div>
          <div className="cv-back-bank">{name}</div>
        </div>
      </div>
    </div>
  )
}
