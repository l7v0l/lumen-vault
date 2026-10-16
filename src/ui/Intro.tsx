import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { Bulb } from './Bulb'

type Phase = 'idle' | 'flick' | 'lit' | 'exit'
interface P { x: number; y: number; vx: number; vy: number; r: number; a: number; life: number; spark: boolean }

export function Intro({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const canvas = useRef<HTMLCanvasElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const state = useRef<{ lit: boolean; burst: () => void }>({ lit: false, burst: () => {} })

  useEffect(() => {
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, raf = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight
      cv.width = w * dpr; cv.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const motes: P[] = Array.from({ length: reduce ? 0 : 70 }, () => ({
      x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.12, vy: -0.05 - Math.random() * 0.2,
      r: 0.6 + Math.random() * 1.8, a: 0.15 + Math.random() * 0.35, life: 1, spark: false,
    }))
    const sparks: P[] = []

    state.current.burst = () => {
      const r = btn.current?.getBoundingClientRect()
      const cx = r ? r.left + r.width / 2 : w / 2
      const cy = r ? r.top + r.height * 0.36 : h / 2
      for (let i = 0; i < (reduce ? 0 : 180); i++) {
        const ang = Math.random() * Math.PI * 2
        const sp = 1.5 + Math.random() * 7
        sparks.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 0.8 + Math.random() * 2.4, a: 1, life: 1, spark: true })
      }
    }

    const tick = () => {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const lit = state.current.lit
      for (const m of motes) {
        m.x += m.vx; m.y += m.vy
        if (m.y < -4) { m.y = h + 4; m.x = Math.random() * w }
        if (m.x < -4) m.x = w + 4
        if (m.x > w + 4) m.x = -4
        ctx.beginPath()
        ctx.fillStyle = lit ? `rgba(255,214,120,${Math.min(0.9, m.a * 2.2)})` : `rgba(130,160,230,${m.a})`
        ctx.arc(m.x, m.y, m.r * (lit ? 1.5 : 1), 0, 7)
        ctx.fill()
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.x += s.vx; s.y += s.vy; s.vx *= 0.975; s.vy = s.vy * 0.975 + 0.04
        s.life -= 0.012
        if (s.life <= 0) { sparks.splice(i, 1); continue }
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5)
        g.addColorStop(0, `rgba(255,236,170,${s.life})`)
        g.addColorStop(1, 'rgba(255,170,40,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 5, 0, 7); ctx.fill()
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  const tap = () => {
    if (phase !== 'idle') return
    setPhase('flick')
    window.setTimeout(() => { state.current.lit = true; state.current.burst(); setPhase('lit') }, 650)
    window.setTimeout(() => setPhase('exit'), 3300)
    window.setTimeout(onDone, 4000)
  }

  const on = phase === 'lit' || phase === 'exit'

  return (
    <div className={'intro ' + phase}>
      <canvas ref={canvas} className="dust" />
      <div className="vignette" />
      <div className="flood" />
      <div className="rays" />
      <i className="ring r1" /><i className="ring r2" /><i className="ring r3" />
      <div className="cord" />
      <button ref={btn} className="bulb-btn" onClick={tap} aria-label={t('tapBulb')}>
        <span className="tapring" />
        <Bulb lit={on} size={170} />
      </button>
      <h1 className="brand" aria-label="Lumen">{'LUMEN'.split('').map((c, i) => <span key={i} style={{ animationDelay: 0.5 + i * 0.12 + 's' }}>{c}</span>)}</h1>
      <p className="tag">{t('tagline')}</p>
      <p className="hint">{t('tapBulb')}</p>
      {phase === 'idle' && <button className="skip" onClick={onDone}>{t('skip')}</button>}
    </div>
  )
}
