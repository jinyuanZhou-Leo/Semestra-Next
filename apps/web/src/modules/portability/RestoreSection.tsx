import type { ImportOut } from '@semestra/api-client'
import {
  portabilityImportDiscardMutation,
  portabilityImportGetOptions,
  portabilityImportGetQueryKey,
  portabilityImportStartMutation,
  portabilityImportUploadMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { SettingRow, SettingsBlock, SettingsGroup, SettingsNote } from '@/app/settings'
import { useUiPref } from '@/app/ui-pref'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { JobProgress } from '@/components/JobProgress'
import { useJob } from '@/hooks/use-job'
import { errorMessage, toastError } from '@/lib/errors'
import { formatBytes, formatCount, formatDateTime } from '@/lib/format'
import { portabilityEntityMessages } from '@/lib/message-groups/portability-entities.gen'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Spinner } from '@/ui/spinner'
import { Switch } from '@/ui/switch'
import { ChoiceControl } from '@/app/settings/choice'

type Counts = Record<string, Record<string, number>>
const labels = portabilityEntityMessages

/** `portability_entity_<module>_<entity>`; entities without a label are not listed. */
function entityRows(counts: Counts): { key: string; label: string; count: number }[] {
  const rows: { key: string; label: string; count: number }[] = []
  for (const [module, entities] of Object.entries(counts)) {
    for (const [entity, count] of Object.entries(entities)) {
      const label = labels[`portability_entity_${module}_${entity}`]
      if (label && count > 0) rows.push({ key: `${module}.${entity}`, label: label(), count })
    }
  }
  return rows
}

function total(counts: Counts): number {
  return Object.values(counts).reduce(
    (sum, entities) => sum + Object.values(entities).reduce((a, b) => a + b, 0),
    0,
  )
}

/** Restore from a backup (M13 §7): drop the file, check the preview, choose how, import. */
export function RestoreSection() {
  // Remembered so that a running import is still shown after leaving the page.
  const [uploadId, setUploadId] = useUiPref<string | null>('portability.restore', null)
  return uploadId ? (
    <UploadedBackup id={uploadId} onDone={() => setUploadId(null)} />
  ) : (
    <BackupDropzone onUploaded={setUploadId} />
  )
}

function BackupDropzone({ onUploaded }: { onUploaded: (id: string) => void }) {
  const upload = useMutation({
    ...portabilityImportUploadMutation(),
    onSuccess: (data) => onUploaded(data.id),
  })
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    multiple: false,
    noClick: true,
    disabled: upload.isPending,
    accept: { 'application/zip': ['.zip'], 'application/json': ['.json'] },
    onDropAccepted: ([file]) => {
      if (file) upload.mutate({ body: { file } })
    },
  })
  return (
    <div className="space-y-2">
      <Empty
        {...getRootProps()}
        className={isDragActive ? 'border-primary bg-primary/5' : 'border'}
      >
        <input {...getInputProps()} aria-label={m.portability_restore_pick()} />
        <EmptyHeader>
          <EmptyMedia variant="icon">{upload.isPending ? <Spinner /> : <Upload />}</EmptyMedia>
          <EmptyTitle>
            {upload.isPending ? m.portability_restore_uploading() : m.portability_restore_drop()}
          </EmptyTitle>
          <EmptyDescription>{m.portability_restore_drop_desc()}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" disabled={upload.isPending} onClick={open}>
            {m.portability_restore_pick()}
          </Button>
        </EmptyContent>
      </Empty>
      {upload.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(upload.error)}
        </p>
      ) : null}
    </div>
  )
}

function UploadedBackup({ id, onDone }: { id: string; onDone: () => void }) {
  const backup = useQuery({ ...portabilityImportGetOptions({ path: { id } }), retry: false })
  // Gone (expired or discarded elsewhere): back to the drop zone.
  const missing = backup.isError
  useEffect(() => {
    if (missing) onDone()
  }, [missing, onDone])
  if (!backup.data) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  }
  const data = backup.data
  if (data.status === 'importing' && data.job_id) {
    return <ImportRunning backup={data} jobId={data.job_id} />
  }
  if (data.status === 'imported') return <ImportFinished backup={data} onDone={onDone} />
  return <ImportForm backup={data} onDiscarded={onDone} />
}

function ImportRunning({ backup, jobId }: { backup: ImportOut; jobId: string }) {
  const queryClient = useQueryClient()
  const { status } = useJob(jobId)
  useEffect(() => {
    if (status === 'succeeded') {
      // Everything may have changed: refetch every query.
      void queryClient.invalidateQueries()
    } else if (status === 'failed' || status === 'cancelled') {
      void queryClient.invalidateQueries({
        queryKey: portabilityImportGetQueryKey({ path: { id: backup.id } }),
      })
    }
  }, [status, queryClient, backup.id])
  return (
    <SettingsGroup>
      <Item>
        <ItemContent>
          <ItemTitle>{m.portability_restore_running()}</ItemTitle>
          <JobProgress jobId={jobId} />
        </ItemContent>
      </Item>
    </SettingsGroup>
  )
}

function ImportFinished({ backup, onDone }: { backup: ImportOut; onDone: () => void }) {
  const discard = useMutation({
    ...portabilityImportDiscardMutation(),
    onSettled: onDone,
  })
  const imported = backup.report?.imported ?? {}
  const skipped = total(backup.report?.skipped ?? {})
  return (
    <div className="space-y-4">
      <Alert>
        <CircleCheck aria-hidden />
        <AlertTitle>{m.portability_restore_done()}</AlertTitle>
        <AlertDescription>
          {m.portability_restore_done_desc({ count: formatCount(total(imported)) })}
        </AlertDescription>
      </Alert>
      <CountList counts={imported} />
      {skipped > 0 ? (
        <SettingsNote>
          {m.portability_restore_skipped({ count: formatCount(skipped) })}
        </SettingsNote>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={discard.isPending}
          onClick={() => discard.mutate({ path: { id: backup.id } })}
        >
          {m.portability_restore_finish()}
        </Button>
      </div>
    </div>
  )
}

function CountList({ counts, filesBytes }: { counts: Counts; filesBytes?: number }) {
  const rows = entityRows(counts)
  return (
    <SettingsGroup>
      {[
        ...rows.map((row) => (
          <SettingRow key={row.key} label={row.label}>
            <span className="text-sm tabular-nums">{formatCount(row.count)}</span>
          </SettingRow>
        )),
        ...(filesBytes
          ? [
              <SettingRow key="files" label={m.portability_entity_files()}>
                <span className="text-sm tabular-nums">{formatBytes(filesBytes)}</span>
              </SettingRow>,
            ]
          : []),
      ]}
    </SettingsGroup>
  )
}

function ImportForm({ backup, onDiscarded }: { backup: ImportOut; onDiscarded: () => void }) {
  const queryClient = useQueryClient()
  const id = useId()
  const preview = backup.preview
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(preview.programs.map((p) => p.id)),
  )
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [includePreferences, setIncludePreferences] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [phrase, setPhrase] = useState('')
  const start = useMutation({
    ...portabilityImportStartMutation(),
    onError: toastError,
    onSuccess: (data) => {
      setConfirming(false)
      queryClient.setQueryData(portabilityImportGetQueryKey({ path: { id: data.id } }), data)
    },
  })
  const discard = useMutation({
    ...portabilityImportDiscardMutation(),
    onError: toastError,
    onSuccess: onDiscarded,
  })
  const run = (confirmation?: string) =>
    start.mutate({
      path: { id: backup.id },
      body: {
        mode,
        program_ids:
          selected.size === preview.programs.length
            ? null
            : preview.programs.filter((p) => selected.has(p.id)).map((p) => p.id),
        include_preferences: includePreferences,
        confirmation: confirmation ?? null,
      },
    })
  const toggle = (programId: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(programId)
    else next.delete(programId)
    setSelected(next)
  }
  const nothingSelected = preview.programs.length > 0 && selected.size === 0
  const phraseMatches = phrase.trim().toLowerCase() === m.portability_replace_phrase().toLowerCase()

  return (
    <div className="space-y-6">
      {backup.status === 'failed' ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{m.portability_restore_failed()}</AlertTitle>
          <AlertDescription>
            {errorMessage({ error: { code: backup.error_code ?? 'common.internal', params: {} } })}
          </AlertDescription>
        </Alert>
      ) : null}
      <SettingsBlock
        title={m.portability_restore_contents()}
        description={m.portability_restore_exported_at({
          time: formatDateTime(preview.exported_at),
        })}
      >
        <CountList
          counts={preview.counts}
          filesBytes={preview.include_files ? preview.files_bytes : 0}
        />
      </SettingsBlock>
      {preview.programs.length > 0 ? (
        <SettingsBlock title={m.portability_restore_programs()}>
          <SettingsGroup>
            {preview.programs.map((program) => (
              <Item key={program.id}>
                <ItemMedia>
                  <Checkbox
                    id={`${id}-${program.id}`}
                    checked={selected.has(program.id)}
                    onCheckedChange={(checked) => toggle(program.id, checked)}
                  />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="min-w-0">
                    <Label htmlFor={`${id}-${program.id}`} className="truncate">
                      {program.name}
                    </Label>
                  </ItemTitle>
                  <ItemDescription>
                    {m.portability_restore_program_counts({
                      terms: program.term_count,
                      courses: program.course_count,
                    })}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </SettingsGroup>
        </SettingsBlock>
      ) : null}
      <SettingsGroup>
        <SettingRow
          label={m.portability_restore_mode()}
          description={m.portability_restore_mode_desc()}
          labelId={`${id}-mode`}
        >
          <ChoiceControl
            labelId={`${id}-mode`}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: m.portability_restore_mode_merge() },
              { value: 'replace', label: m.portability_restore_mode_replace() },
            ]}
          />
        </SettingRow>
        <SettingRow
          label={m.portability_restore_preferences()}
          description={m.portability_restore_preferences_desc()}
          labelId={`${id}-prefs`}
        >
          <Switch
            aria-labelledby={`${id}-prefs`}
            checked={includePreferences}
            onCheckedChange={setIncludePreferences}
          />
        </SettingRow>
      </SettingsGroup>
      {preview.quota_exceeded ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{m.portability_restore_quota()}</AlertDescription>
        </Alert>
      ) : null}
      {preview.unknown_modules.length > 0 ? (
        <SettingsNote>{m.portability_restore_unknown()}</SettingsNote>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={discard.isPending || start.isPending}
          onClick={() => discard.mutate({ path: { id: backup.id } })}
        >
          {m.portability_restore_discard()}
        </Button>
        <Button
          disabled={nothingSelected || start.isPending}
          onClick={() => (mode === 'replace' ? setConfirming(true) : run())}
        >
          {m.portability_restore_start()}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open)
          if (!open) setPhrase('')
        }}
        title={m.portability_replace_title()}
        description={m.portability_replace_desc()}
        confirmLabel={m.portability_restore_mode_replace()}
        pending={start.isPending}
        confirmDisabled={!phraseMatches}
        extra={
          <Field>
            <FieldLabel htmlFor={`${id}-phrase`}>
              {m.portability_type_to_confirm({ phrase: m.portability_replace_phrase() })}
            </FieldLabel>
            <Input
              id={`${id}-phrase`}
              autoComplete="off"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
          </Field>
        }
        onConfirm={() => run(phrase)}
      />
    </div>
  )
}
