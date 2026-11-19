import type { FilesUsageGet } from '@semestra/api-client'

/**
 * The file's SHA-256 as hex, matching `ItemOut.sha256`. Web Crypto exists only in a secure context
 * (https or localhost); a self-hosted instance opened at `http://<LAN address>` hashes with
 * `@noble/hashes`, loaded only then.
 */
export async function sha256Hex(file: Blob): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  // oxlint-disable-next-line no-restricted-properties -- the one place with the fallback
  const subtle = globalThis.crypto.subtle as SubtleCrypto | undefined
  if (subtle) return toHex(new Uint8Array(await subtle.digest('SHA-256', data)))
  const { sha256 } = await import('@noble/hashes/sha2.js')
  return toHex(sha256(data))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export type UploadPlan = {
  /** Larger than the single-file limit; never sent. */
  tooLarge: File[]
  /** Fit within the limit; `room` is false when together they do not fit in the quota. */
  accepted: File[]
  room: boolean
  /** Bytes still free; null when there is no quota. */
  remaining: number | null
}

/** The checks the server makes again (M07 §4), done first so nothing is sent in vain. */
export function planUpload(files: readonly File[], usage: FilesUsageGet | undefined): UploadPlan {
  const max = usage?.max_upload_bytes ?? Infinity
  const tooLarge = files.filter((f) => f.size > max)
  const accepted = files.filter((f) => f.size <= max)
  const remaining =
    usage && usage.quota_bytes > 0 ? Math.max(0, usage.quota_bytes - usage.used_bytes) : null
  const total = accepted.reduce((sum, f) => sum + f.size, 0)
  return { tooLarge, accepted, room: remaining === null || total <= remaining, remaining }
}
