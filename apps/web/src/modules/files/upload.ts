import type { FilesUsageGet, ItemOut } from '@semestra/api-client'

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

/**
 * Files that look already uploaded to this course. The rule is M07's (`items.find_duplicate`): the
 * same bytes, or the same name and size, anywhere in the course (a file read from its source, such
 * as an LMS, has no hash of its bytes here). An upload also asks about the same name in the target
 * folder.
 */
export function findDuplicates(
  files: readonly { file: File; sha256: string }[],
  existing: readonly Pick<
    ItemOut,
    'kind' | 'display_name' | 'size_bytes' | 'sha256' | 'folder_id'
  >[],
  folderId: string | null,
): Set<File> {
  const stored = existing.filter((i) => i.kind === 'file')
  const hashes = new Set(stored.map((i) => i.sha256).filter(Boolean))
  const sized = new Set(stored.map((i) => `${i.display_name.toLowerCase()}:${i.size_bytes}`))
  const names = new Set(
    stored.filter((i) => i.folder_id === folderId).map((i) => i.display_name.toLowerCase()),
  )
  return new Set(
    files
      .filter(({ file, sha256 }) => {
        const name = file.name.toLowerCase()
        return hashes.has(sha256) || sized.has(`${name}:${file.size}`) || names.has(name)
      })
      .map(({ file }) => file),
  )
}
