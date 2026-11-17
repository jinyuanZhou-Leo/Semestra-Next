import type { FilesItemList, PlannedMove } from '@semestra/api-client'
import {
  filesOrganizationApplyMutation,
  filesOrganizationGetOptions,
  filesOrganizationStartMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Folder } from 'lucide-react'
import { useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { JobProgress } from '@/components/JobProgress'
import { useJob } from '@/hooks/use-job'
import { toastError } from '@/lib/errors'
import { omitKey } from '@/lib/omit'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Label } from '@/ui/label'
import { Spinner } from '@/ui/spinner'
import { invalidateFiles } from '../queries'
import { FileIcon } from './FileIcon'

/** The organizing job of each course still waiting to be reviewed: course id → job id. */
const PREF = 'files.organize'

/**
 * The course's organizing (M07 §8): the job that works out where each unsorted file goes, kept
 * across visits until the user applies or discards its plan.
 */
export function useOrganize(courseId: string) {
  const queryClient = useQueryClient()
  const [jobs, setJobs] = useUiPref<Record<string, string>>(PREF, {})
  const jobId = jobs[courseId] ?? null
  const forget = () => setJobs(omitKey(jobs, courseId))
  const start = useMutation({
    ...filesOrganizationStartMutation(),
    onError: toastError,
    onSuccess: (job) => {
      setJobs({ ...jobs, [courseId]: job.id })
      void queryClient.invalidateQueries({ queryKey: [{ _id: 'coreJobList' }] })
    },
  })
  return {
    jobId,
    starting: start.isPending,
    start: () => start.mutate({ path: { course_id: courseId } }),
    forget,
  }
}

type Organize = ReturnType<typeof useOrganize>

function withoutOrganize(prev: Record<string, string | undefined>) {
  const { organize: _organize, ...rest } = prev
  return rest
}

/**
 * Whether the dialog is open: by the toolbar button, or by a link (`?organize=1`, the status
 * bar's link to a finished job), which leaves the URL once the dialog closes.
 */
export function useOrganizeOpen() {
  const search = useSearch({ strict: false }) as { organize?: unknown }
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const linked = search.organize === '1'
  return {
    open: open || linked,
    setOpen: (next: boolean) => {
      setOpen(next)
      if (!next && linked) void navigate({ to: '.', search: withoutOrganize, replace: true })
    },
  }
}

export function OrganizeDialog({
  courseId,
  list,
  organize,
  open,
  onOpenChange,
}: {
  courseId: string
  list: FilesItemList
  organize: Organize
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { job, status } = useJob(organize.jobId)
  const done = status === 'succeeded'
  const plan = useQuery({
    ...filesOrganizationGetOptions({
      path: { course_id: courseId, job_id: organize.jobId ?? '' },
    }),
    enabled: done && organize.jobId !== null,
  })
  const finish = () => {
    organize.forget()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{m.files_organize_title()}</DialogTitle>
          <DialogDescription>
            {done ? m.files_organize_review_description() : m.files_organize_description()}
          </DialogDescription>
        </DialogHeader>
        {done && plan.data ? (
          <Review
            key={organize.jobId}
            courseId={courseId}
            list={list}
            moves={plan.data.moves}
            left={plan.data.left}
            onDone={finish}
          />
        ) : done || !job ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <>
            <JobProgress jobId={job.id} job={job} />
            <DialogFooter>
              {status === 'failed' || status === 'cancelled' ? (
                <Button disabled={organize.starting} onClick={organize.start}>
                  {m.files_organize_retry()}
                </Button>
              ) : (
                <DialogClose render={<Button variant="outline" />}>
                  {m.files_organize_background()}
                </DialogClose>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Review({
  courseId,
  list,
  moves,
  left,
  onDone,
}: {
  courseId: string
  list: FilesItemList
  moves: readonly PlannedMove[]
  left: number
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const items = new Map(list.items.map((i) => [i.id, i]))
  const folders = new Map(list.folders.map((f) => [f.id, f.name]))
  // Files deleted since the plan are left out.
  const shown = moves.filter((move) => items.has(move.item_id))
  const groups = new Map<string, PlannedMove[]>()
  for (const move of shown) {
    const key = move.folder_id ?? `new:${move.type}`
    groups.set(key, [...(groups.get(key) ?? []), move])
  }
  const kept = shown.filter((move) => !skipped.has(move.item_id))
  const apply = useMutation({
    ...filesOrganizationApplyMutation(),
    onError: toastError,
    onSuccess: () => {
      void invalidateFiles(queryClient, courseId)
      onDone()
    },
  })
  const toggle = (id: string) =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (shown.length === 0) {
    return (
      <>
        <Empty className="border-0 p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Folder aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.files_organize_nothing()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
        <DialogFooter>
          <Button onClick={onDone}>{m.files_organize_close()}</Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <div className="max-h-[min(28rem,60vh)] overflow-y-auto rounded-2xl border">
        {[...groups.values()].map((group) => {
          const [first] = group
          if (!first) return null
          return (
            <section key={first.folder_id ?? first.type} aria-label={first.folder_name}>
              <h3 className="flex items-center gap-2 bg-muted/50 px-3.5 py-2 text-sm font-medium [&:not(:first-child)]:border-t">
                <Folder aria-hidden className="size-4 text-muted-foreground" />
                {first.folder_name}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {group.length}
                </span>
                {first.folder_id === null ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    · {m.files_organize_new_folder()}
                  </span>
                ) : null}
              </h3>
              {group.map((move) => {
                const item = items.get(move.item_id)
                if (!item) return null
                const id = `organize-${move.item_id}`
                return (
                  <div
                    key={move.item_id}
                    className="flex h-10 items-center gap-2.5 border-t px-3.5 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={!skipped.has(move.item_id)}
                      onCheckedChange={() => toggle(move.item_id)}
                    />
                    <FileIcon item={item} className="size-4 shrink-0 text-muted-foreground" />
                    <Label htmlFor={id} className="min-w-0 flex-1 truncate font-normal">
                      {item.display_name}
                    </Label>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.folder_id
                        ? (folders.get(item.folder_id) ?? '')
                        : m.files_organize_top_level()}
                    </span>
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
      {left > 0 ? (
        <p className="text-sm text-muted-foreground">{m.files_organize_left({ count: left })}</p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {m.common_cancel()}
        </Button>
        <Button
          disabled={kept.length === 0 || apply.isPending}
          onClick={() =>
            apply.mutate({
              path: { course_id: courseId },
              body: { moves: kept.map(({ item_id, type }) => ({ item_id, type })) },
            })
          }
        >
          {apply.isPending ? <Spinner /> : null}
          {m.files_organize_apply({ count: kept.length })}
        </Button>
      </DialogFooter>
    </>
  )
}
