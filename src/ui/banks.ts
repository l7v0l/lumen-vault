import type { Lang } from '../i18n'

/** Visual themes only: brand-inspired gradients + the bank's name as text. No logos are used. */
export interface BankStyle { id: string; name: Record<Lang, string>; g: [string, string]; dark?: boolean }

const b = (id: string, ar: string, en: string, zh: string, g: [string, string]): BankStyle => ({ id, name: { ar, en, zh }, g })

export const BANKS: BankStyle[] = [
  b('snb', 'البنك الأهلي', 'Al Ahli Bank (SNB)', '国民银行 (SNB)', ['#055a43', '#19b88c']),
  b('rajhi', 'مصرف الراجحي', 'Al Rajhi Bank', '拉吉希银行', ['#0a2a6e', '#2563d8']),
  b('riyad', 'بنك الرياض', 'Riyad Bank', '利雅得银行', ['#073b78', '#2d8fe0']),
  b('alinma', 'مصرف الإنماء', 'Alinma Bank', '因玛银行', ['#43301f', '#c29552']),
  b('sab', 'ساب', 'SAB', '沙特英国银行', ['#6d0b13', '#e5353f']),
  b('albilad', 'بنك البلاد', 'Bank Albilad', '比拉德银行', ['#12305c', '#f0902a']),
  b('jazira', 'بنك الجزيرة', 'Bank Aljazira', '贾兹拉银行', ['#0a4a47', '#33bfb1']),
  b('bsf', 'البنك السعودي الفرنسي', 'Banque Saudi Fransi', '沙特法兰西银行', ['#12367a', '#d6372f']),
  b('anb', 'البنك العربي الوطني', 'Arab National Bank', '阿拉伯国民银行', ['#0b5aa8', '#63baf2']),
  b('stc', 'stc bank', 'stc bank', 'stc bank', ['#35176a', '#a24fff']),
  b('neom', 'نيوم', 'NEOM', 'NEOM', ['#04070c', '#1d7a7e']),
  b('aurora', 'أورورا', 'Aurora', '极光', ['#0f2a5c', '#2dd4bf']),
  b('sunset', 'غروب', 'Sunset', '日落', ['#5b1d63', '#ff8a4c']),
  b('graphite', 'جرافيت', 'Graphite', '石墨', ['#1b1f27', '#4a5568']),
  b('gold', 'ذهبي', 'Gold', '金色', ['#4a3510', '#e8b94a']),
]

export const NETWORKS = [
  { id: 'mada', label: 'mada' },
  { id: 'visa', label: 'VISA' },
  { id: 'mastercard', label: 'Mastercard' },
] as const

export const bankById = (id?: string) => BANKS.find((x) => x.id === id) ?? BANKS[11]

export function luhn(num: string): boolean {
  const d = num.replace(/\D/g, '')
  if (d.length < 12) return false
  let s = 0
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i]
    if (i % 2) { n *= 2; if (n > 9) n -= 9 }
    s += n
  }
  return s % 10 === 0
}

export const groupNumber = (n: string) => n.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim()
export const fmtExpiry = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d
}
