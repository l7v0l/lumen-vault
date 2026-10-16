import { randInt } from './bytes'

export interface GenOpts { length: number; lower: boolean; upper: boolean; digits: boolean; symbols: boolean; avoidAmbiguous: boolean }
export const defaultGen: GenOpts = { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true }

export function generatePassword(o: GenOpts): string {
  const clean = (s: string) => (o.avoidAmbiguous ? s.replace(/[Il1O0o]/g, '') : s)
  const sets = [
    o.lower && clean('abcdefghijklmnopqrstuvwxyz'),
    o.upper && clean('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    o.digits && clean('0123456789'),
    o.symbols && '!@#$%^&*()-_=+[]{};:,.?/',
  ].filter(Boolean) as string[]
  if (!sets.length) return ''
  const len = Math.max(o.length, sets.length)
  const all = sets.join('')
  const out: string[] = sets.map((s) => s[randInt(s.length)]) // one of each class
  while (out.length < len) out.push(all[randInt(all.length)])
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}
