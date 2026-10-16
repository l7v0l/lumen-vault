export function Bulb({ lit, size = 200 }: { lit: boolean; size?: number }) {
  return (
    <svg className={'bulb' + (lit ? ' lit' : '')} width={size} height={size * 1.4} viewBox="0 0 100 140" aria-hidden>
      <defs>
        <linearGradient id="bg-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" /><stop offset=".55" stopColor="#ffc857" /><stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id="bg-cap" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5eead4" /><stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <path className="glass" d="M50 8C28 8 12 25 12 47c0 15 8 24 15 33 4 5 5 9 5 14h36c0-5 1-9 5-14 7-9 15-18 15-33C88 25 72 8 50 8Z" />
      <path className="shine" d="M30 30c4-9 12-14 20-14" fill="none" strokeWidth="4" strokeLinecap="round" />
      <g className="filament">
        <circle cx="50" cy="44" r="10" />
        <path d="M45 50h10l3 24H42Z" />
      </g>
      <rect className="cap" x="31" y="98" width="38" height="8" rx="4" />
      <rect className="cap" x="33" y="110" width="34" height="8" rx="4" />
      <path className="cap" d="M40 122h20c0 6-4 10-10 10s-10-4-10-10Z" />
    </svg>
  )
}
