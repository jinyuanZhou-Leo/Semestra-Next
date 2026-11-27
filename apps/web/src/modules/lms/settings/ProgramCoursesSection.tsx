import type { Course, CourseLink, ExternalCourse } from '@semestra/api-client'
import {
  academicsCourseListOptions,
  lmsCourseLinkDeleteMutation,
  lmsCourseLinkGetOptions,
  lmsCourseLinkListOptions,
  lmsCourseLinkSetMutation,
  lmsCourseListOptions,
  lmsProgramBindingGetOptions,
  lmsSyncRequestMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import {
  ArrowRight,
  ExternalLink,
  Lightbulb,
  Link2,
  Link2Off,
  RefreshCw,
  Replace,
  Settings2,
} from 'lucide-react'
import { createContext, use, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  RowMenu,
  SettingsBlock,
  SettingsGroup,
  SettingsTable,
  settingsTableFeatures,
  useSettingsDialog,
} from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useNow } from '@/hooks/use-now'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { courseColor } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { externalLabel } from '../external'
import { useProviderName } from '../providers'
import { courseLinkTargets, invalidateTargets } from '../queries'
import { syncedAgo } from '../sync/status'
import { PlatformCoursePicker } from './PlatformCoursePicker'
import { suggestLinks } from './suggest'
import { UnlinkMaterials } from './UnlinkMaterials'

type Linked = { course: Course; link: CourseLink }

/**
 * Program settings → LMS → Course links (M09 §7.1): every course of the Program and the platform
 * course it is linked to. The courses not linked come first, each with a picker, and the matches
 * by code above them to link at once; then the linked courses as a table.
 */
export function ProgramCoursesSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const path = { path: { program_id: programId } }
  const binding = useQuery(lmsProgramBindingGetOptions(path))
  const bound = Boolean(binding.data?.connection_id)
  const courses = useQuery(academicsCourseListOptions({ ...path, query: { limit: 500 } }))
  const links = useQuery({ ...lmsCourseLinkListOptions(path), enabled: bound })
  // Every term's courses: a course's match may be in a term not current yet.
  const externals = useQuery({
    ...lmsCourseListOptions({ ...path, query: { include_past: true } }),
    enabled: bound,
  })
  const provider = useProviderName(binding.data?.connection?.provider) ?? m.lms_name()

  if (binding.data && !bound) {
    return (
      <Empty className="rounded-2xl border border-solid border-border p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2 aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.lms_links_unbound()}</EmptyTitle>
          <EmptyDescription>{m.lms_links_unbound_hint()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (!courses.data || !links.data) return <Skeleton className="h-40 rounded-2xl" />

  const byCourse = new Map(links.data.items.map((l) => [l.course_id, l]))
  const sorted = courses.data.items.toSorted((a, b) =>
    (a.code ?? a.title).localeCompare(b.code ?? b.title),
  )
  const unlinked = sorted.filter((c) => !byCourse.has(c.id))
  const linked = sorted.flatMap((course) => {
    const link = byCourse.get(course.id)
    return link ? [{ course, link }] : []
  })
  const suggested = suggestLinks(unlinked, externals.data?.items ?? [])

  return (
    <div className="space-y-6">
      {unlinked.length ? (
        <Unlinked
          programId={programId}
          provider={provider}
          courses={unlinked}
          suggested={suggested}
        />
      ) : null}
      {linked.length ? (
        <LinkedTable programId={programId} provider={provider} rows={linked} />
      ) : null}
    </div>
  )
}

/** Links a course, then refetches what its link changes (its own event skips this tab). */
function useLinkCourse(programId: string) {
  const queryClient = useQueryClient()
  const link = useMutation({ ...lmsCourseLinkSetMutation(), onError: toastError })
  const refetch = (courseId: string) =>
    invalidateTargets(queryClient, courseLinkTargets(courseId, programId))
  return {
    link: (courseId: string, external: ExternalCourse, replace = false) =>
      link
        .mutateAsync({
          path: { course_id: courseId },
          body: { external_course_id: external.external_id, replace },
        })
        .then(() => refetch(courseId)),
    pending: link.isPending,
  }
}

function Unlinked({
  programId,
  provider,
  courses,
  suggested,
}: {
  programId: string
  provider: string
  courses: readonly Course[]
  suggested: Map<string, ExternalCourse>
}) {
  const { link, pending } = useLinkCourse(programId)
  const [linkingAll, setLinkingAll] = useState(false)
  const pairs = courses.flatMap((course) => {
    const external = suggested.get(course.id)
    return external ? [{ course, external }] : []
  })
  // One after another, so each course's first sync is queued in order; one that fails is told
  // (`toastError`) and the rest still link.
  const linkAll = async () => {
    setLinkingAll(true)
    for (const { course, external } of pairs) {
      await link(course.id, external).catch(() => undefined)
    }
    setLinkingAll(false)
  }

  return (
    <SettingsBlock title={m.lms_links_unlinked({ count: courses.length })}>
      {pairs.length ? (
        <Alert>
          <Lightbulb aria-hidden />
          <AlertTitle>{m.lms_links_suggested({ count: pairs.length, provider })}</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {pairs.map(({ course, external }) => (
                <li key={course.id} className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-foreground">{course.code ?? course.title}</span>
                  <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {[externalLabel(external), external.term].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
          <AlertAction>
            <Button size="sm" disabled={linkingAll || pending} onClick={() => void linkAll()}>
              {linkingAll ? <Spinner aria-hidden /> : null}
              {m.lms_links_link_all()}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <SettingsGroup>
        {courses.map((course) => (
          <Item key={course.id}>
            <ItemMedia>
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ background: courseColor(course) }}
              />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="w-full" id={`lms-link-${course.id}`}>
                <span className="shrink-0">{course.code ?? course.title}</span>
                {course.code ? (
                  <span className="truncate font-normal text-muted-foreground">{course.title}</span>
                ) : null}
              </ItemTitle>
            </ItemContent>
            <ItemActions>
              <PlatformCoursePicker
                programId={programId}
                courseId={course.id}
                courseCode={course.code}
                labelId={`lms-link-${course.id}`}
                disabled={linkingAll}
                onPick={(external) => void link(course.id, external).catch(() => undefined)}
                className="w-56"
              />
            </ItemActions>
          </Item>
        ))}
      </SettingsGroup>
    </SettingsBlock>
  )
}

type RowActions = {
  provider: string
  sync: (row: Linked) => void
  syncing: boolean
  change: (row: Linked) => void
  unlink: (row: Linked) => void
  settings: (row: Linked) => void
}

const RowContext = createContext<RowActions | null>(null)

function useRowActions(): RowActions {
  const actions = use(RowContext)
  if (!actions) throw new Error('Link cells render inside the course links table')
  return actions
}

type CellProps = CellContext<typeof settingsTableFeatures, Linked>

function CourseCell({ row }: CellProps) {
  const { course } = row.original
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: courseColor(course) }}
      />
      <div className="min-w-0">
        <div className="truncate font-medium">{course.code ?? course.title}</div>
        {course.code ? (
          <div className="truncate text-xs text-muted-foreground">{course.title}</div>
        ) : null}
      </div>
    </div>
  )
}

function PlatformHeader() {
  return m.lms_course_pick({ provider: useRowActions().provider })
}

function PlatformCell({ row }: CellProps) {
  const { link } = row.original
  return (
    <div className="min-w-0">
      <div className="truncate">{link.external_name ?? link.external_code}</div>
      <div className="truncate text-xs text-muted-foreground">
        {[link.external_name ? link.external_code : null, link.external_term]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>
  )
}

/** How the course's last sync went (M09 表 5c); when it synced only while it went well. */
function SyncCell({ row }: CellProps) {
  const { link } = row.original
  const now = useNow()
  if (!link.sync_enabled) {
    return <span className="text-xs text-muted-foreground">{m.lms_links_sync_off()}</span>
  }
  if (link.sync_state === 'failed')
    return <Badge variant="destructive">{m.lms_link_failed()}</Badge>
  if (link.sync_state === 'stale') return <Badge variant="secondary">{m.lms_link_stale()}</Badge>
  return link.synced_at ? (
    <span className="text-xs text-muted-foreground">{syncedAgo(link.synced_at, now)}</span>
  ) : null
}

function ActionsCell({ row }: CellProps) {
  const actions = useRowActions()
  const { course, link } = row.original
  return (
    <RowMenu label={m.lms_course_actions({ course: course.code ?? course.title })}>
      <DropdownMenuItem
        disabled={actions.syncing || !link.sync_enabled}
        onClick={() => actions.sync(row.original)}
      >
        <RefreshCw aria-hidden />
        {m.lms_sync_now()}
      </DropdownMenuItem>
      {link.web_url ? (
        <DropdownMenuItem
          render={
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the item gives it its text
            <a href={link.web_url} target="_blank" rel="noreferrer" />
          }
        >
          <ExternalLink aria-hidden />
          {m.lms_open_in({ provider: actions.provider })}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={() => actions.change(row.original)}>
        <Replace aria-hidden />
        {m.lms_course_change_menu()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => actions.settings(row.original)}>
        <Settings2 aria-hidden />
        {m.lms_links_course_settings()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => actions.unlink(row.original)}>
        <Link2Off aria-hidden />
        {m.lms_course_unlink_menu()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, Linked>()
const columns = column.columns([
  column.display({ id: 'course', header: () => m.lms_links_course(), cell: CourseCell }),
  column.display({
    id: 'platform',
    header: PlatformHeader,
    cell: PlatformCell,
  }),
  column.display({ id: 'sync', header: () => m.lms_links_sync(), cell: SyncCell }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = {
  course: 'w-56 max-w-56',
  sync: 'w-28 whitespace-nowrap',
  actions: 'w-10',
}

function LinkedTable({
  programId,
  provider,
  rows,
}: {
  programId: string
  provider: string
  rows: readonly Linked[]
}) {
  const queryClient = useQueryClient()
  const settings = useSettingsDialog()
  const changing = useDialogTarget<Linked>()
  const unlinking = useDialogTarget<Linked>()
  // Runs in the background; the sync's status line tells how it went.
  const sync = useMutation({ ...lmsSyncRequestMutation(), onError: toastError })
  const remove = useMutation({
    ...lmsCourseLinkDeleteMutation(),
    onSuccess: (_state, { path }) => {
      unlinking.close()
      void invalidateTargets(queryClient, courseLinkTargets(path.course_id, programId))
    },
    onError: (err) => (unlinking.close(), toastError(err)),
  })
  const actions: RowActions = {
    provider,
    syncing: sync.isPending,
    sync: ({ course }) =>
      sync.mutate({ path: { program_id: programId }, body: { course_id: course.id, force: true } }),
    change: changing.show,
    unlink: unlinking.show,
    settings: ({ course }) => settings.open({ level: 'course', group: 'lms', scope: course.id }),
  }

  return (
    <SettingsBlock title={m.lms_links_linked({ count: rows.length })}>
      <RowContext value={actions}>
        <SettingsTable
          label={m.lms_links_linked({ count: rows.length })}
          data={rows}
          columns={columns}
          getRowId={(row) => row.course.id}
          fill="platform"
          columnClassName={COLUMN_CLASS}
        />
      </RowContext>
      <ChangeCourseDialog
        {...changing.props}
        programId={programId}
        row={changing.target}
        close={changing.close}
      />
      <ConfirmDialog
        {...unlinking.props}
        title={m.lms_course_unlink_title()}
        description={m.lms_course_unlink_desc()}
        extra={
          unlinking.target ? (
            <UnlinkCounts courseId={unlinking.target.course.id} provider={provider} />
          ) : undefined
        }
        confirmLabel={m.lms_course_unlink()}
        pending={remove.isPending}
        onConfirm={() =>
          unlinking.target
            ? remove.mutate({ path: { course_id: unlinking.target.course.id } })
            : undefined
        }
      />
    </SettingsBlock>
  )
}

/** What unlinking does to the course's materials, read when the confirmation opens. */
function UnlinkCounts({ courseId, provider }: { courseId: string; provider: string }) {
  const state = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data
  return state?.materials ? <UnlinkMaterials counts={state.materials} provider={provider} /> : null
}

/**
 * Moves a course's link to another platform course: picking one is the confirmation, since the
 * dialog says first what moving drops.
 */
function ChangeCourseDialog({
  programId,
  row,
  close,
  ...props
}: {
  programId: string
  row: Linked | null
  close: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { link, pending } = useLinkCourse(programId)
  const label = row ? (row.course.code ?? row.course.title) : ''
  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.lms_links_change_title({ course: label })}</DialogTitle>
          <DialogDescription>{m.lms_course_change_desc()}</DialogDescription>
        </DialogHeader>
        {row ? (
          <PlatformCoursePicker
            programId={programId}
            courseId={row.course.id}
            courseCode={row.course.code}
            currentId={row.link.external_course_id}
            disabled={pending}
            onPick={(external) =>
              void link(row.course.id, external, true).then(close, () => undefined)
            }
            className="w-full"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
