import type { SourceRef } from '@semestra/api-client'
import { FileText } from 'lucide-react'
import { m } from '@/paraglide/messages'

export type FileRow = {
  key: string
  name: string
  status: 'pending' | 'uploading' | 'extracting' | 'done' | 'failed'
}

/** A session's files as rows. */
export function sessionRows(refs: SourceRef[]): FileRow[] {
  return refs.map((ref, index) => ({
    key: ref.upload_id ?? ref.file_item_id ?? String(index),
    name: ref.filename ?? m.imports_file(),
    status: ref.status ?? 'pending',
  }))
}

const STATUS_LABEL = {
  pending: () => m.imports_file_pending(),
  uploading: () => m.imports_file_uploading(),
  extracting: () => m.imports_file_extracting(),
  done: () => m.imports_file_done(),
  failed: () => m.imports_file_failed(),
}

/** The files of an import and how far each one is (uploading, then reading). */
export function FileStatusList({ rows }: { rows: FileRow[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 rounded-xl px-2 py-1">
          <FileText aria-hidden className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[row.status]()}</span>
        </li>
      ))}
    </ul>
  )
}
