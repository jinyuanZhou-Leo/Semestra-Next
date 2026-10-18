import {
  coreJobCancelMutation,
  coreJobListOptions,
  settingsValuesGetOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { JobProgress } from '@/components/JobProgress'
import { useUiPref } from '@/app/ui-pref'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'

const STATUS_LABEL = {
  pending: m.template_job_pending,
  running: m.template_job_running,
  succeeded: m.template_job_succeeded,
  failed: m.template_job_failed,
  cancelled: m.template_job_cancelled,
} as const

/** The user's background jobs, kept live by `core.job.progress` events. */
export default function TemplatePage() {
  const jobs = useQuery(coreJobListOptions())
  const cancel = useMutation({ ...coreJobCancelMutation(), onError: toastError })
  // Module configuration (M11 settings framework): the user sets it on the settings page.
  const settings = useQuery(settingsValuesGetOptions({ path: { namespace: 'plugin.template' } }))
  const compact = settings.data?.values.compact === true
  // Interface state (M11 useUiPref): remembered per user, not shown on any settings page.
  const [hideFinished, setHideFinished] = useUiPref('template.hide_finished', false)

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold">{m.template_page_title()}</h1>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={hideFinished}
          onClick={() => setHideFinished(!hideFinished)}
        >
          {m.template_page_hide_finished()}
        </Button>
      </div>
      <AsyncBoundary
        query={jobs}
        isEmpty={(page) => page.items.length === 0}
        empty={<p className="text-sm text-muted-foreground">{m.template_jobs_empty()}</p>}
      >
        {(page) => (
          <ul className={cn('divide-y divide-border', compact ? 'text-sm' : '')}>
            {page.items
              .filter(
                (job) => !hideFinished || job.status === 'pending' || job.status === 'running',
              )
              .map((job) => (
                <li
                  key={job.id}
                  className={cn('flex items-center gap-4', compact ? 'py-1' : 'py-3')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{job.kind}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(job.created_at)}
                    </div>
                  </div>
                  <JobProgress jobId={job.id} job={job} className="w-40" />
                  <Badge variant="secondary">{STATUS_LABEL[job.status]()}</Badge>
                  {job.status === 'pending' || job.status === 'running' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancel.isPending || job.cancel_requested}
                      aria-label={m.template_job_cancel_aria({ kind: job.kind })}
                      onClick={() => cancel.mutate({ path: { job_id: job.id } })}
                    >
                      {m.template_job_cancel()}
                    </Button>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </AsyncBoundary>
    </div>
  )
}
