import type { FilesUsageGet, ItemOut } from '@semestra/api-client'

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
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
 * Files that look already uploaded to this course: the same bytes anywhere in the course, or the
 * same name in the target folder.
 */
export function findDuplicates(
  files: readonly { file: File; sha256: string }[],
  existing: readonly ItemOut[],
  folderId: string | null,
): Set<File> {
  const hashes = new Set(existing.map((i) => i.sha256).filter(Boolean))
  const names = new Set(
    existing
      .filter((i) => i.kind === 'file' && i.folder_id === folderId)
      .map((i) => i.display_name.toLowerCase()),
  )
  return new Set(
    files
      .filter(({ file, sha256 }) => hashes.has(sha256) || names.has(file.name.toLowerCase()))
      .map(({ file }) => file),
  )
}
