/** Desktop shell bridge (Tauri). In a plain browser all of this is a no-op. */
type Tauri = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
const tauri = (window as unknown as { __TAURI_INTERNALS__?: Tauri }).__TAURI_INTERNALS__

export const isDesktop = !!tauri
export const invoke = <T>(cmd: string, args?: Record<string, unknown>) => tauri!.invoke(cmd, args) as Promise<T>

let secret: Promise<Uint8Array | undefined> | undefined

/** 32-byte secret protected by the OS (Windows DPAPI): bound to this user + machine, never uploaded. */
export function deviceSecret(): Promise<Uint8Array | undefined> {
  if (!isDesktop) return Promise.resolve(undefined)
  secret ??= invoke<number[]>('device_secret').then((a) => new Uint8Array(a)).catch(() => undefined)
  return secret
}
