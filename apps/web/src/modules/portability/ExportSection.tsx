import { client, type ExportOut } from '@semestra/api-client'
import {
  coreStorageGetOptions,
  portabilityExportListOptions,
  portabilityExportListQueryKey,
  portabilityExportStartMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { SettingRow, SettingsBlock, SettingsGroup } from '@/app/settings'
import { JobProgress } from '@/components/JobProgress'
import { useJob } from '@/hooks/use-job'
import { toastError } from '@/lib/errors'
import { formatBytes, formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
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
          <SettingsGroup>
            {items.map((item) => (
              <ExportRow key={item.id} item={item} />
            ))}
          </SettingsGroup>
        </SettingsBlock>
      ) : null}
    </div>
  )
}

function downloadUrl(exportId: string): string {
  return `${client.getConfig().baseUrl ?? ''}/me/exports/${exportId}/download`
}

function ExportRow({ item }: { item: ExportOut }) {
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
    <Item>
      <ItemContent className="min-w-0">
        <ItemTitle>{formatDateTime(item.created_at)}</ItemTitle>
        {item.status === 'pending' && item.job_id ? (
          <JobProgress jobId={item.job_id} variant="inline" />
        ) : item.status === 'failed' ? (
          <ItemDescription className="text-destructive">
            {m.portability_export_failed()}
          </ItemDescription>
        ) : (
          <ItemDescription>
            {[
              ...details,
              m.portability_export_expires({ time: formatDateTime(item.expires_at) }),
            ].join(' · ')}
          </ItemDescription>
        )}
      </ItemContent>
      {item.status === 'ready' ? (
        <ItemActions>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={downloadUrl(item.id)}
                download
                aria-label={m.portability_export_download()}
              />
            }
          >
            <Download />
            {m.portability_export_download()}
          </Button>
        </ItemActions>
      ) : null}
    </Item>
  )
}
