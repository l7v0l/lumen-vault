import type { VaultFile } from '../crypto/vault'
import { stripLocal } from '../crypto/vault'

/**
 * Optional encrypted cloud backup/sync. The cloud only ever receives the
 * master-password-wrapped vault (no PIN/biometric wrappers). Sign-in proves
 * which cloud account to use; it does NOT unlock the vault.
 */
export type Provider = 'google' | 'microsoft'

const GOOGLE_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const MS_ID = import.meta.env.VITE_MS_CLIENT_ID as string | undefined

const FILE = 'lumen-vault.json'
let session: { provider: Provider; token: string; expires: number } | null = null

export const availableProviders = (): Provider[] => [GOOGLE_ID && 'google', MS_ID && 'microsoft'].filter(Boolean) as Provider[]
export const connected = (): Provider | null => (session && session.expires > Date.now() ? session.provider : null)
export const disconnect = () => { session = null }

// ---------- Google (Identity Services token flow, scope: app data folder only) ----------
function loadGsi(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.onload = () => res(); s.onerror = () => rej(new Error('gsi'))
    document.head.appendChild(s)
  })
}

async function googleToken(): Promise<{ token: string; expires: number }> {
  await loadGsi()
  return new Promise((res, rej) => {
    const c = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_ID,
      scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: (r: { access_token?: string; expires_in?: number; error?: string }) =>
        r.access_token ? res({ token: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 - 30000 }) : rej(new Error(r.error || 'google')),
      error_callback: (e: { type?: string }) => rej(new Error('google-' + (e?.type || 'popup'))),
    })
    c.requestAccessToken()
  })
}

const gh = () => ({ Authorization: 'Bearer ' + session!.token })

async function gFind(): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE}'`)
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`, { headers: gh() })
  if (!r.ok) throw new Error('drive-' + r.status)
  return (await r.json()).files?.[0]?.id ?? null
}

// ---------- Microsoft (OAuth2 code + PKCE, SPA, scope: app folder only) ----------
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const redirect = () => location.origin + location.pathname
const MS_SCOPE = 'Files.ReadWrite.AppFolder offline_access'

async function msToken(): Promise<{ token: string; expires: number }> {
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(48)))
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = 'lumen-ms-' + b64u(crypto.getRandomValues(new Uint8Array(12)))
  const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + new URLSearchParams({
    client_id: MS_ID!, response_type: 'code', redirect_uri: redirect(), scope: MS_SCOPE, state,
    code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  })
  const pop = window.open(url, 'lumen-oauth', 'width=480,height=640')
  if (!pop) throw new Error('popup')
  const code = await new Promise<string>((res, rej) => {
    const t = window.setInterval(() => { if (pop.closed) { clearInterval(t); window.removeEventListener('message', on); rej(new Error('closed')) } }, 500)
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== 'lumen-oauth' || e.data.state !== state) return
      clearInterval(t); window.removeEventListener('message', on)
      e.data.code ? res(e.data.code) : rej(new Error('denied'))
    }
    window.addEventListener('message', on)
  })
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MS_ID!, grant_type: 'authorization_code', code, redirect_uri: redirect(), code_verifier: verifier, scope: MS_SCOPE }),
  })
  if (!r.ok) throw new Error('ms-token')
  const j = await r.json()
  return { token: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 - 30000 }
}

/** Call at app start: if this window is the OAuth popup, hand the code back and close. */
export function handleOAuthPopup(): boolean {
  const p = new URLSearchParams(location.search)
  const state = p.get('state')
  if (!window.opener || !state?.startsWith('lumen-ms-')) return false
  window.opener.postMessage({ type: 'lumen-oauth', state, code: p.get('code') }, location.origin)
  window.close()
  return true
}

const MS_URL = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${FILE}:/content`

// ---------- public API ----------
export async function connect(p: Provider): Promise<void> {
  const t = p === 'google' ? await googleToken() : await msToken()
  session = { provider: p, ...t }
}

export async function pull(): Promise<string | null> {
  if (!connected()) throw new Error('not-connected')
  if (session!.provider === 'google') {
    const id = await gFind()
    if (!id) return null
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: gh() })
    if (!r.ok) throw new Error('drive-' + r.status)
    return r.text()
  }
  const r = await fetch(MS_URL, { headers: gh() })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('onedrive')
  return r.text()
}

export async function push(file: VaultFile): Promise<void> {
  if (!connected()) return
  const body = JSON.stringify(stripLocal(file))
  if (session!.provider === 'google') {
    const id = await gFind()
    if (id) {
      const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { ...gh(), 'Content-Type': 'application/json' }, body })
      if (!r.ok) throw new Error('drive')
    } else {
      const b = '-----lumen' + Math.random().toString(36).slice(2)
      const multipart = `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: FILE, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { ...gh(), 'Content-Type': `multipart/related; boundary=${b}` }, body: multipart })
      if (!r.ok) throw new Error('drive')
    }
    return
  }
  const r = await fetch(MS_URL, { method: 'PUT', headers: { ...gh(), 'Content-Type': 'application/json' }, body })
  if (!r.ok) throw new Error('onedrive')
}
