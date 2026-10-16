export const enc = new TextEncoder()
export const dec = new TextDecoder()

export function rand(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function b64(u: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s)
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

/** Best-effort zeroization (JS cannot guarantee no copies remain). */
export function wipe(...bufs: (Uint8Array | undefined)[]): void {
  for (const b of bufs) b?.fill(0)
}

/** Unbiased random integer in [0, max) via rejection sampling. */
export function randInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const a = new Uint32Array(1)
  do crypto.getRandomValues(a)
  while (a[0] >= limit)
  return a[0] % max
}
