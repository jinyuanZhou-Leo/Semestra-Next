import type { AiStatusGet } from '@semestra/api-client'
import {
  aiLocalModelDeleteMutation,
  aiLocalModelDownloadMutation,
  aiStatusGetOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Download, ScanText, Search, Trash2 } from 'lucide-react'
import { createContext, use, useState } from 'react'
import {
  RowMenu,
  SettingsBlock,
  SettingsNote,
  SettingsTable,
  settingsTableFeatures,
} from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { JobProgress } from '@/components/JobProgress'
import { useDialogTarget } from '@/lib/dialog-target'
import { formatBytes } from '@/lib/format'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { Spinner } from '@/ui/spinner'
import { LOCAL_MODELS, PURPOSE_TITLES } from '../labels'
import { invalidateAi } from '../queries'

// Account settings → Data → local models (M06 §7): the OCR and embedding models a self-hosted
// server runs itself, with the space each takes. They are shared by every account on the
// server; a deleted one downloads again the next time it is needed.

type Purpose = 'ocr' | 'embedding'

type LocalRow = {
  purpose: Purpose
  model: string
  downloaded: boolean
  /** On disk when downloaded, else the download's size when known. */
  bytes: number | null
  /** Downloading now, for anyone. */
  downloading: boolean
  /** This user's own download of it, while it runs or after it failed. */
  jobId: string | null
  inUse: boolean
}

function rowsOf(status: AiStatusGet, jobs: Record<string, string>): LocalRow[] {
  return (status.local ?? []).flatMap((entry) => {
    const used = status.items.find((item) => item.purpose === entry.purpose)
    const usedModel = used?.source === 'local' ? used.model : null
    return entry.models.map((model) => {
      const downloaded = entry.downloaded.includes(model)
      return {
        purpose: entry.purpose,
        model,
        downloaded,
        bytes: entry.sizes?.[model] ?? LOCAL_MODELS[model]?.bytes ?? null,
        downloading: entry.downloading.includes(model),
        jobId: downloaded
          ? null
          : (jobs[`${entry.purpose}:${model}`] ??
            (model === usedModel ? (entry.download_job ?? null) : null)),
        inUse: model === usedModel,
      }
    })
  })
}

type RowHandlers = {
  onDownload: (row: LocalRow) => void
  onDelete: (row: LocalRow) => void
  starting: string | null
}

const RowContext = createContext<RowHandlers | null>(null)

function useRowHandlers() {
  const handlers = use(RowContext)
  if (!handlers) throw new Error('local model rows need RowContext')
  return handlers
}

type CellProps = CellContext<typeof settingsTableFeatures, LocalRow, unknown>

function Detail({ row }: { row: LocalRow }) {
  if (!row.downloaded && row.jobId) {
    return <JobProgress jobId={row.jobId} variant="compact" />
  }
  if (!row.downloaded && row.downloading) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner aria-hidden className="size-3" />
        {m.ai_models_local_downloading()}
      </span>
    )
  }
  const parts = [
    row.inUse ? m.ai_local_models_in_use() : null,
    row.downloaded ? null : m.ai_models_local_missing(),
  ].filter(Boolean)
  if (!parts.length) return null
  return <div className="truncate text-xs text-muted-foreground">{parts.join(' · ')}</div>
}

function NameCell({ row }: CellProps) {
  const local = row.original
  const Icon = local.purpose === 'ocr' ? ScanText : Search
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{local.model}</div>
        <Detail row={local} />
      </div>
    </div>
  )
}

function SizeCell({ row }: CellProps) {
  const { bytes, downloaded } = row.original
  return (
    <span className={cn('block text-right tabular-nums', !downloaded && 'text-muted-foreground')}>
      {bytes === null ? '' : formatBytes(bytes)}
    </span>
  )
}

function ActionsCell({ row }: CellProps) {
  const { onDownload, onDelete, starting } = useRowHandlers()
  const local = row.original
  const busy = local.downloading || starting === `${local.purpose}:${local.model}`
  return (
    <RowMenu label={m.ai_local_models_actions({ model: local.model })}>
      {local.downloaded ? (
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(local)}>
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem disabled={busy} onClick={() => onDownload(local)}>
          <Download aria-hidden />
          {m.ai_models_local_download()}
        </DropdownMenuItem>
      )}
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, LocalRow>()
const columns = column.columns([
  column.accessor((row) => row.model, {
    id: 'name',
    header: () => m.ai_local_models_model(),
    cell: NameCell,
  }),
  column.display({
    id: 'size',
    header: () => <span className="block text-right">{m.ai_local_models_size()}</span>,
    cell: SizeCell,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = {
  name: 'w-full max-w-0',
  size: 'w-28 whitespace-nowrap',
  actions: 'w-10',
}

function deleteDescription(row: LocalRow | null): string {
  if (!row) return ''
  if (row.inUse) {
    return row.purpose === 'ocr'
      ? m.ai_local_models_delete_desc_ocr_in_use()
      : m.ai_local_models_delete_desc_embedding_in_use()
  }
  return m.ai_local_models_delete_desc({ size: formatBytes(row.bytes ?? 0) })
}

/**
 * Account settings → Data → local models: one table per purpose, each model's size, and
 * download / delete in the row's "⋯" menu. Renders nothing on servers without local models.
 */
export function LocalModelsSection() {
  const queryClient = useQueryClient()
  // The user's own downloads started here, by `purpose:model` (the status only names the job
  // of the model each purpose uses).
  const [jobs, setJobs] = useState<Record<string, string>>({})
  const status = useQuery({
    ...aiStatusGetOptions(),
    // Only the user whose job it is hears that a download finished: poll while one runs.
    refetchInterval: (query) =>
      query.state.data?.local?.some((entry) => entry.downloading.length) ? 3000 : false,
  })
  const download = useMutation({
    ...aiLocalModelDownloadMutation(),
    onSuccess: async (result, { body }) => {
      const jobId = result.job_id
      if (jobId) setJobs((current) => ({ ...current, [`${body.purpose}:${body.model}`]: jobId }))
      await invalidateAi(queryClient)
    },
    onError: toastError,
  })
  const deleting = useDialogTarget<LocalRow>()
  const remove = useMutation({
    ...aiLocalModelDeleteMutation(),
    onSuccess: async () => {
      deleting.close()
      await invalidateAi(queryClient)
    },
    onError: (err) => {
      deleting.close()
      toastError(err)
    },
  })

  const data = status.data
  if (!data?.local?.length) return null
  const rows = rowsOf(data, jobs)
  const total = rows.reduce((sum, row) => sum + (row.downloaded ? (row.bytes ?? 0) : 0), 0)
  const handlers: RowHandlers = {
    starting: download.isPending
      ? `${download.variables?.body.purpose}:${download.variables?.body.model}`
      : null,
    onDownload: (row) => download.mutate({ body: { purpose: row.purpose, model: row.model } }),
    onDelete: deleting.show,
  }

  return (
    <RowContext value={handlers}>
      {data.local.map((entry) => {
        const title = PURPOSE_TITLES[entry.purpose]()
        return (
          <SettingsBlock key={entry.purpose} title={title}>
            <SettingsTable
              label={title}
              data={rows.filter((row) => row.purpose === entry.purpose)}
              columns={columns}
              getRowId={(row) => row.model}
              columnClassName={COLUMN_CLASS}
            />
          </SettingsBlock>
        )
      })}
      <SettingsNote>{m.ai_local_models_total({ size: formatBytes(total) })}</SettingsNote>
      <ConfirmDialog
        {...deleting.props}
        title={m.ai_local_models_delete_title({ model: deleting.target?.model ?? '' })}
        description={deleteDescription(deleting.target)}
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() =>
          deleting.target &&
          remove.mutate({
            body: { purpose: deleting.target.purpose, model: deleting.target.model },
          })
        }
      />
    </RowContext>
  )
}
