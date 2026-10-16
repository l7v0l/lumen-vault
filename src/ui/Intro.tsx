import { useState } from 'react'
import { useI18n } from '../i18n'
import { Bulb } from './Bulb'

export function Intro({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [lit, setLit] = useState(false)

  const tap = () => {
    if (lit) return
    setLit(true)
    window.setTimeout(onDone, 2600)
  }

  return (
    <div className={'intro' + (lit ? ' lit' : '')}>
      <div className="flood" />
      <div className="rays" />
      <div className="cord" />
      <button className="bulb-btn" onClick={tap} aria-label={t('tapBulb')}>
        <Bulb lit={lit} size={170} />
      </button>
      <h1 className="brand">Lumen</h1>
      <p className="tag">{t('tagline')}</p>
      <p className="hint">{t('tapBulb')}</p>
      {!lit && <button className="skip" onClick={onDone}>{t('skip')}</button>}
    </div>
  )
}
