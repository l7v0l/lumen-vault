import type { VaultFile } from './crypto/vault'
import type { Lang } from './i18n'
import { invoke, isDesktop } from './device'

/** Storage seam: swap for Tauri fs (app data dir) or a synced folder later. */
const VAULT_KEY = 'lumen.vault'
const PREFS_KEY = 'lumen.prefs'

let cache: string | null = null

/** Desktop: the vault lives in a file in the app-data folder (atomic writes). Browser: localStorage. */
export async function initStore(): Promise<void> {
  if (!isDesktop) return
  try {
    cache = await invoke<string | null>('read_file', { name: 'vault.json' })
    if (cache === null) {
      const old = localStorage.getItem(VAULT_KEY)
      if (old) { cache = old; await invoke('write_file', { name: 'vault.json', content: old }) }
    }
  } catch { cache = localStorage.getItem(VAULT_KEY) }
}

export function loadVault(): VaultFile | null {
  try {
    const s = isDesktop ? cache : localStorage.getItem(VAULT_KEY)
    return s ? (JSON.parse(s) as VaultFile) : null
  } catch { return null }
}
export function storeVault(f: VaultFile): void {
  const text = JSON.stringify(f)
  if (isDesktop) {
    cache = text
    invoke('write_file', { name: 'vault.json', content: text }).catch(() => localStorage.setItem(VAULT_KEY, text))
  } else localStorage.setItem(VAULT_KEY, text)
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
