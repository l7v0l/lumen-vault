import type { VaultFile } from './crypto/vault'
import type { Lang } from './i18n'

/** Storage seam: swap for Tauri fs (app data dir) or a synced folder later. */
const VAULT_KEY = 'lumen.vault'
const PREFS_KEY = 'lumen.prefs'

export function loadVault(): VaultFile | null {
  try {
    const s = localStorage.getItem(VAULT_KEY)
    return s ? (JSON.parse(s) as VaultFile) : null
  } catch { return null }
}
export function storeVault(f: VaultFile): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(f))
}

export interface Prefs { lang: Lang; autoLockMin: number; introSeen: boolean; side: boolean; quickOffered: boolean }
const defaults: Prefs = { lang: 'ar', autoLockMin: 5, introSeen: false, side: true, quickOffered: false }

export function loadPrefs(): Prefs {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { return defaults }
}
export function storePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* ignore */ }
}

let clipTimer: number | undefined
/** Copy and auto-clear after 20s. */
export async function copySecret(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  window.clearTimeout(clipTimer)
  clipTimer = window.setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}) }, 20000)
}
