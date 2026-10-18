import {
  coreJobCancelMutation,
  coreJobGetOptions,
  coreJobGetQueryKey,
} from '@semestra/api-client/react-query'
import type { JobOut } from '@semestra/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toastError } from '@/lib/errors'
import * as m from '@/paraglide/messages'

type MessageFn = (params?: Record<string, unknown>) => string
const messages = m as unknown as Record<string, MessageFn | undefined>

export type JobCount = { current: number; total: number }

/**
 * Text for the job's current stage: `job_step_<kind>_<step>` (dots in `kind` become underscores),
 * with the count inside the stage when the job reports one, and a prefix when it is a retry.
 * Progress percentages always come from the backend (M00 §3.6).
 */
export function jobStageLabel(
  job: Pick<JobOut, 'kind' | 'step' | 'step_current' | 'step_total' | 'attempts'>,
) {
  const key = job.step ? `job_step_${job.kind.replaceAll('.', '_')}_${job.step}` : null
  let label = (key && messages[key]?.()) || m.job_running()
  if (job.step_current != null && job.step_total != null) {
    label = m.job_stage_count({ stage: label, current: job.step_current, total: job.step_total })
  }
  return job.attempts > 1 ? m.job_retry_prefix({ label }) : label
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
  const count: JobCount | null =
    job?.step_current != null && job.step_total != null
      ? { current: job.step_current, total: job.step_total }
      : null
  return {
    job,
    status: job?.status,
    progress: job?.progress ?? 0,
    stageLabel: job ? jobStageLabel(job) : '',
    count,
    /** True when this run is a retry after a failed attempt. */
    retry: (job?.attempts ?? 0) > 1,
    cancelling: cancelMutation.isPending || Boolean(job?.cancel_requested),
    cancel: () => {
      if (jobId) cancelMutation.mutate({ path: { job_id: jobId } })
    },
  }
}
