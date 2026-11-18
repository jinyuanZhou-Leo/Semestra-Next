import type { FilesItemList, OrganizeState, PlannedMove } from '@semestra/api-client'
import {
  filesOrganizationApplyMutation,
  filesOrganizationDiscardMutation,
  filesOrganizationGetOptions,
  filesOrganizationGetQueryKey,
  filesOrganizationStartMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, FolderInput, FolderSync } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAiGate, useProviderProblem } from '@/components/AiRequired'
import { JobProgress } from '@/components/JobProgress'
import { useElementHeight } from '@/hooks/use-element-size'
import { useJob } from '@/hooks/use-job'
import { toastError } from '@/lib/errors'
import type { FilesLocation } from '../location'
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
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { invalidateFiles } from '../queries'
import { FileIcon } from './FileIcon'

/**
 * The course's organizing (M07 §8), as the server keeps it: its job while it reads or when it
 * failed, then the plan until the user applies or discards it.
 */
export function useOrganizeState(courseId: string) {
  return useQuery(filesOrganizationGetOptions({ path: { course_id: courseId } }))
}

/** Starts (or starts again) the course's organizing; the job shows at once. */
export function useOrganizeStart(courseId: string) {
  const queryClient = useQueryClient()
  const start = useMutation({
    ...filesOrganizationStartMutation(),
    onError: toastError,
    onSuccess: (job) => {
      queryClient.setQueryData<OrganizeState>(
        filesOrganizationGetQueryKey({ path: { course_id: courseId } }),
        { job, plan: null },
      )
      void queryClient.invalidateQueries({ queryKey: [{ _id: 'coreJobList' }] })
    },
  })
  return {
    starting: start.isPending,
    start: () => start.mutate({ path: { course_id: courseId } }),
  }
}

/**
 * Whether the toolbar button opens what is there instead of starting: a reading, a failure not
 * yet seen, or a plan with files still to move. A plan with nothing left reads again.
 */
export function organizeWaits(state: OrganizeState | undefined) {
  return Boolean(state?.job || (state?.plan && state.plan.moves.length > 0))
}

/**
 * Whether the dialog is open: by the toolbar button, or by a link (`?organize=true`, the status
 * bar's way back), which leaves the URL once the dialog closes.
 */
export function useOrganizeOpen(location: FilesLocation) {
  const [open, setOpen] = useState(false)
  return {
    open: open || location.organize,
    setOpen: (next: boolean) => {
      setOpen(next)
      if (!next && location.organize) location.go({ organize: false }, { replace: true })
    },
  }
}

/** Follows its content's height, so switching from reading to the review doesn't jump. */
function Resizing({ children }: { children: ReactNode }) {
  const [inner, setInner] = useState<HTMLDivElement | null>(null)
  const height = useElementHeight(inner)
  return (
    <div
      className="-m-1 overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
      style={{ height: height ? height + 8 : 'auto' }}
    >
      <div ref={setInner} className="flex flex-col gap-4 p-1">
        {children}
      </div>
    </div>
  )
}

export function OrganizeDialog({
  courseId,
  list,
  open,
  onOpenChange,
}: {
  courseId: string
  list: FilesItemList
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const state = useOrganizeState(courseId)
  const { starting, start } = useOrganizeStart(courseId)
  const plan = state.data?.plan ?? null
  // Followed live: a failure ends the job without changing the plan.
  const { job, status } = useJob(state.data?.job?.id ?? null, state.data?.job ?? undefined)
  const failed = status === 'failed' || status === 'cancelled'
  const discard = useMutation({ ...filesOrganizationDiscardMutation(), onError: toastError })
  // A failure is done with once seen: closing it leaves nothing on the status line.
  const changeOpen = (next: boolean) => {
    if (!next && failed && !starting) discard.mutate({ path: { course_id: courseId } })
    onOpenChange(next)
  }
  const close = () => changeOpen(false)

  let body: ReactNode
  if (plan) {
    body = (
      <Review
        courseId={courseId}
        list={list}
        moves={plan.moves}
        left={plan.left}
        starting={starting}
        onAgain={start}
        onDone={close}
      />
    )
  } else if (job && state.data?.job) {
    // Kept at 100% once read, until the plan arrives: one change of height, not two.
    body = (
      <>
        <JobProgress jobId={job.id} job={job} />
        {failed ? null : (
          <p className="text-sm text-muted-foreground">{m.files_organize_background_hint()}</p>
        )}
        <DialogFooter>
          {failed ? (
            <Failed code={job.error_code} starting={starting} onRetry={start} onClose={close} />
          ) : (
            <DialogClose render={<Button variant="outline" />}>
              {m.files_organize_background()}
            </DialogClose>
          )}
        </DialogFooter>
      </>
    )
  } else if (state.isPending) {
    body = (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  } else {
    // Nothing waits: an old link, or starting failed.
    body = (
      <>
        <Empty className="border-0 p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderInput aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.files_organize_none()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{m.common_close()}</DialogClose>
          <Button disabled={starting} onClick={start}>
            {m.files_organize()}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{m.files_organize_title()}</DialogTitle>
          <DialogDescription>
            {plan ? m.files_organize_review_description() : m.files_organize_description()}
          </DialogDescription>
        </DialogHeader>
        <Resizing>{body}</Resizing>
      </DialogContent>
    </Dialog>
  )
}

/** A failed reading: a provider's problem leads to its settings, anything else can be retried. */
function Failed({
  code,
  starting,
  onRetry,
  onClose,
}: {
  code: string | null | undefined
  starting: boolean
  onRetry: () => void
  onClose: () => void
}) {
  const provider = useProviderProblem('title', code)
  return (
    <>
      <DialogClose render={<Button variant="outline" />}>{m.common_close()}</DialogClose>
      {provider ? (
        <Button
          onClick={() => {
            onClose()
            provider.fix()
          }}
        >
          {provider.action}
        </Button>
      ) : (
        <Button disabled={starting} onClick={onRetry}>
          {m.files_organize_retry()}
        </Button>
      )}
    </>
  )
}

/**
 * The user's own files the plan leaves where they are; without a model to place them, that is
 * why, with where to add one.
 */
function Left({ count }: { count: number }) {
  const gate = useAiGate('title')
  if (count === 0) return null
  if (!gate) {
    return <p className="text-sm text-muted-foreground">{m.files_organize_left({ count })}</p>
  }
  return (
    <p className="text-sm text-muted-foreground">
      {m.files_organize_left_needs_model({ count })}{' '}
      <Button variant="link" className="h-auto p-0" onClick={gate.fix}>
        {gate.action}
      </Button>
    </p>
  )
}

/** A plan's moves go in groups by folder: an existing one, one to make, or the top level. */
function groupKey(move: PlannedMove) {
  return move.folder_id ?? (move.new_folder ? `new:${move.folder_name}` : 'top')
}

function Review({
  courseId,
  list,
  moves,
  left,
  starting,
  onAgain,
  onDone,
}: {
  courseId: string
  list: FilesItemList
  moves: readonly PlannedMove[]
  left: number
  starting: boolean
  onAgain: () => void
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const items = new Map(list.items.map((i) => [i.id, i]))
  const folders = new Map(list.folders.map((f) => [f.id, f.name]))
  const shown = moves.filter((move) => items.has(move.item_id))
  const groups = new Map<string, PlannedMove[]>()
  for (const move of shown) {
    const key = groupKey(move)
    groups.set(key, [...(groups.get(key) ?? []), move])
  }
  const kept = shown.filter((move) => !skipped.has(move.item_id))
  const done = () => {
    void invalidateFiles(queryClient, courseId)
    onDone()
  }
  const apply = useMutation({
    ...filesOrganizationApplyMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const discard = useMutation({
    ...filesOrganizationDiscardMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const busy = apply.isPending || discard.isPending
  const toggle = (id: string) =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const discardButton = (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => discard.mutate({ path: { course_id: courseId } })}
    >
      {shown.length === 0 ? m.common_close() : m.files_organize_discard()}
    </Button>
  )

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
        <Left count={left} />
        <DialogFooter>{discardButton}</DialogFooter>
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
            <section
              key={groupKey(first)}
              aria-label={first.folder_name || m.files_organize_top_level()}
              className="not-first:border-t"
            >
              <h3 className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-sm font-medium">
                {first.back ? (
                  // Back to where its source has it now.
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <FolderSync aria-hidden className="size-4 text-muted-foreground" />
                      <span className="sr-only">
                        {m.files_origin_folder({ provider: first.back })}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {m.files_origin_folder({ provider: first.back })}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Folder aria-hidden className="size-4 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate">
                  {first.folder_name || m.files_organize_top_level()}
                </span>
                <span className="font-normal text-muted-foreground tabular-nums">
                  {group.length}
                </span>
                {first.new_folder ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    · {m.files_organize_new_folder()}
                  </span>
                ) : null}
              </h3>
              <ItemGroup>
                {group.map((move) => {
                  const item = items.get(move.item_id)
                  if (!item) return null
                  const id = `organize-${move.item_id}`
                  return (
                    <Item key={move.item_id} size="xs" className="rounded-none border-t">
                      <ItemMedia>
                        <Checkbox
                          id={id}
                          checked={!skipped.has(move.item_id)}
                          onCheckedChange={() => toggle(move.item_id)}
                        />
                      </ItemMedia>
                      <ItemMedia>
                        <FileIcon item={item} className="size-4 text-muted-foreground" />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="w-full">
                          <Label htmlFor={id} className="min-w-0 truncate font-normal">
                            {item.display_name}
                          </Label>
                        </ItemTitle>
                      </ItemContent>
                      <ItemActions className="text-xs text-muted-foreground">
                        {move.from_folder_id
                          ? (folders.get(move.from_folder_id) ?? '')
                          : m.files_organize_top_level()}
                      </ItemActions>
                    </Item>
                  )
                })}
              </ItemGroup>
            </section>
          )
        })}
      </div>
      <Left count={left} />
      <DialogFooter>
        {/* The plan is as it was when read: files added since are not in it. */}
        <Button
          variant="ghost"
          className="sm:mr-auto"
          disabled={busy || starting}
          onClick={onAgain}
        >
          {m.files_organize_again()}
        </Button>
        {discardButton}
        <Button
          disabled={kept.length === 0 || busy}
          onClick={() =>
            apply.mutate({
              path: { course_id: courseId },
              body: { item_ids: kept.map((move) => move.item_id) },
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
