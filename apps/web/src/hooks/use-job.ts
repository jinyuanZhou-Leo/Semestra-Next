import {
  coreJobCancelMutation,
  coreJobGetOptions,
  coreJobGetQueryKey,
} from '@semestra/api-client/react-query'
import type { JobOut } from '@semestra/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toastError } from '@/lib/errors'
import { jobStepMessages } from '@/lib/message-groups/job-steps.gen'
import { m } from '@/paraglide/messages'

export type JobCount = { current: number; total: number }

type Waits = Pick<JobOut, 'status' | 'waiting'>

/** Whether the job is waiting: queued behind other jobs, or for its provider. */
export function jobIsWaiting(job: Waits) {
  return job.status === 'pending' || (job.status === 'running' && job.waiting != null)
}

/** When a waiting job expects to go on, if it knows (a rate limit's wait). */
export function jobWaitsUntil(job: Waits): number | null {
  const until = job.status === 'running' ? job.waiting?.until : null
  return until ? new Date(until).getTime() : null
}

/** What a waiting job waits for, e.g. "Rate limited by the provider, continuing in about 40 s". */
export function jobWaitingText(job: Waits, now: number) {
  const reason = job.status === 'running' ? job.waiting?.reason : null
  if (reason === 'ai.provider_busy') return m.job_waiting_provider_busy()
  if (reason === 'ai.rate_limited') {
    const until = jobWaitsUntil(job)
    const seconds = until === null ? 0 : Math.ceil((until - now) / 1000)
    return seconds > 0 ? m.job_waiting_rate_limited({ seconds }) : m.job_waiting_rate_limited_soon()
  }
  return m.job_pending()
}

/**
 * Text for the job's current stage: `job_step_<kind>_<step>` (dots in `kind` become underscores),
 * with the count inside the stage when the job reports one, and a prefix when it is a retry.
 * Progress percentages always come from the backend (M00 §3.6). Pass `withCount: false` where the
 * count is shown on its own, so a narrow label can be cut without losing it. A step whose count has
 * a unit names it in `job_step_<kind>_<step>_count` (e.g. `{current}/{total} MB`).
 */
export function jobStageLabel(
  job: Pick<JobOut, 'kind' | 'step' | 'step_current' | 'step_total' | 'attempts'>,
  withCount = true,
) {
  const key = stepKey(job)
  let label = (key && jobStepMessages[key]?.()) || m.job_running()
  if (withCount && job.step_current != null && job.step_total != null) {
    const count = { current: job.step_current, total: job.step_total }
    const text = countText(job, count)
    label = text
      ? m.job_stage_count_text({ stage: label, count: text })
      : m.job_stage_count({ stage: label, ...count })
  }
  return job.attempts > 1 ? m.job_retry_prefix({ label }) : label
}

function stepKey(job: Pick<JobOut, 'kind' | 'step'>) {
  return job.step ? `job_step_${job.kind.replaceAll('.', '_')}_${job.step}` : null
}

/** The count with the step's unit, when the step names one. */
function countText(job: Pick<JobOut, 'kind' | 'step'>, count: JobCount) {
  const key = stepKey(job)
  return (key && jobStepMessages[`${key}_count`]?.(count)) || null
}

/**
 * A background job kept live over SSE (see `app/realtime.ts`), with its cancel action. Pass `seed`
 * when the job is already loaded (e.g. a row of `core.job.list`) to skip fetching it again.
 */
export function useJob(jobId: string | null | undefined, seed?: JobOut) {
  const queryClient = useQueryClient()
  const query = useQuery({
    ...coreJobGetOptions({ path: { job_id: jobId ?? '' } }),
    enabled: Boolean(jobId),
    ...(seed ? { initialData: seed, staleTime: Infinity } : {}),
  })
  const cancelMutation = useMutation({
    ...coreJobCancelMutation(),
    onError: toastError,
    onSuccess: (job) =>
      queryClient.setQueryData(coreJobGetQueryKey({ path: { job_id: job.id } }), job),
  })
  const job = query.data
  const counted: JobCount | null =
    job?.step_current != null && job.step_total != null
      ? { current: job.step_current, total: job.step_total }
      : null
  const count =
    job && counted
      ? { ...counted, text: countText(job, counted) ?? `${counted.current}/${counted.total}` }
      : null
  return {
    job,
    status: job?.status,
    progress: job?.progress ?? 0,
    stageLabel: job ? jobStageLabel(job) : '',
    /** The stage without its count, for layouts that show `count.text` separately. */
    stageName: job ? jobStageLabel(job, false) : '',
    count,
    /** True when this run is a retry after a failed attempt. */
    retry: (job?.attempts ?? 0) > 1,
    cancelling: cancelMutation.isPending || Boolean(job?.cancel_requested),
    cancel: () => {
      if (jobId) cancelMutation.mutate({ path: { job_id: jobId } })
    },
  }
}
