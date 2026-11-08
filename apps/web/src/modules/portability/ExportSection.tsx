import { client, type ExportOut } from '@semestra/api-client'
import {
  coreStorageGetOptions,
  portabilityExportListOptions,
  portabilityExportListQueryKey,
  portabilityExportStartMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { Download } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  SettingsTable,
  settingsTableFeatures,
} from '@/app/settings'
import { JobProgress } from '@/components/JobProgress'
import { useJob } from '@/hooks/use-job'
import { toastError } from '@/lib/errors'
import { formatBytes, formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Switch } from '@/ui/switch'

/** Export everything to a backup file (M13 §7); the last few exports stay downloadable. */
export function ExportSection() {
  const queryClient = useQueryClient()
  const id = useId()
  const [includeFiles, setIncludeFiles] = useState(false)
  const usage = useQuery(coreStorageGetOptions())
  const exports = useQuery(portabilityExportListOptions())
  const start = useMutation({
    ...portabilityExportStartMutation(),
    onError: toastError,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: portabilityExportListQueryKey() }),
  })
  const filesBytes = usage.data?.used_bytes ?? 0
  const items = exports.data?.items ?? []
  const running = items.some((e) => e.status === 'pending')

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingRow
          label={m.portability_export_files()}
          description={
            filesBytes > 0
              ? m.portability_export_files_desc({ size: formatBytes(filesBytes) })
              : m.portability_export_files_none()
          }
          labelId={`${id}-files`}
        >
          <Switch
            aria-labelledby={`${id}-files`}
            checked={includeFiles}
            disabled={filesBytes === 0}
            onCheckedChange={setIncludeFiles}
          />
        </SettingRow>
        <SettingRow
          label={m.portability_export_action_label()}
          description={m.portability_export_contents()}
        >
          <Button
            disabled={start.isPending || running}
            onClick={() => start.mutate({ body: { include_files: includeFiles } })}
          >
            {m.portability_export_action()}
          </Button>
        </SettingRow>
      </SettingsGroup>
      {items.length > 0 ? (
        <SettingsBlock
          title={m.portability_export_recent()}
          description={m.portability_export_recent_desc()}
        >
          <SettingsTable
            label={m.portability_export_recent()}
            data={items}
            columns={columns}
            getRowId={(item) => item.id}
            columnClassName={COLUMN_CLASS}
          />
        </SettingsBlock>
      ) : null}
    </div>
  )
}

function downloadUrl(exportId: string): string {
  return `${client.getConfig().baseUrl ?? ''}/me/exports/${exportId}/download`
}

function ExportCell({ item }: { item: ExportOut }) {
  const queryClient = useQueryClient()
  const { status } = useJob(item.status === 'pending' ? item.job_id : null)
  // The list knows the file once the job is done; refetch it then.
  useEffect(() => {
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
      void queryClient.invalidateQueries({ queryKey: portabilityExportListQueryKey() })
    }
  }, [status, queryClient])

  const details = [
    item.include_files ? m.portability_export_with_files() : m.portability_export_without_files(),
    item.size_bytes != null ? formatBytes(item.size_bytes) : null,
  ].filter(Boolean)

  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{formatDateTime(item.created_at)}</div>
      {item.status === 'pending' && item.job_id ? (
        <JobProgress jobId={item.job_id} variant="inline" className="block truncate" />
      ) : item.status === 'failed' ? (
        <div className="truncate text-xs text-destructive">{m.portability_export_failed()}</div>
      ) : (
        <div className="truncate text-xs text-muted-foreground">
          {[
            ...details,
            m.portability_export_expires({ time: formatDateTime(item.expires_at) }),
          ].join(' · ')}
        </div>
      )}
    </div>
  )
}

function DownloadCell({ item }: { item: ExportOut }) {
  if (item.status !== 'ready') return null
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={
        <a href={downloadUrl(item.id)} download aria-label={m.portability_export_download()} />
      }
    >
      <Download aria-hidden />
      {m.portability_export_download()}
    </Button>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, ExportOut>()
const columns = column.columns([
  column.display({
    id: 'export',
    header: () => m.portability_export_recent(),
    cell: ({ row }) => <ExportCell item={row.original} />,
  }),
  column.display({
    id: 'download',
    header: () => <span className="sr-only">{m.portability_export_download()}</span>,
    cell: ({ row }) => <DownloadCell item={row.original} />,
  }),
])
const COLUMN_CLASS = { export: 'w-full max-w-0', download: 'text-right' }
