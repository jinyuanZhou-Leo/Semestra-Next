import type {
  Connection,
  CourseLink,
  CourseLinkState,
  ExternalCourse,
  MaterialCounts,
} from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  lmsConnectionListOptions,
  lmsCourseLinkDeleteMutation,
  lmsCourseLinkGetOptions,
  lmsCourseLinkGetQueryKey,
  lmsCourseLinkSetMutation,
  lmsCourseLinkUpdateMutation,
  lmsCourseListOptions,
  lmsProgramBindingGetOptions,
  lmsSyncRequestMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Lightbulb, Link2, Link2Off, RefreshCw, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import type { SettingsSectionProps } from '@/app/extensions'
import { RowMenu, SettingRow, SettingsBlock, SettingsGroup } from '@/app/settings'
import { NamespaceForm } from '@/app/settings/NamespaceForm'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { useNow } from '@/hooks/use-now'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { Switch } from '@/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { externalLabel } from '../external'
import { useProviderName, useProviderUis } from '../providers'
import { MATERIALS } from '../queries'
import { syncedAgo } from '../sync/status'
import { ConnectionItem } from './ConnectionItem'
import { ConnectionStatus, LogoTile } from './ConnectionsSection'
import { HeldMaterials } from './HeldMaterials'
import { MATERIAL_FIELDS } from './MaterialsSection'
import { PlatformCoursePicker } from './PlatformCoursePicker'
import { useOpenConnections, useProgramBinding } from './ProgramLmsSection'
import { suggestLinks } from './suggest'
import { UnlinkMaterials } from './UnlinkMaterials'

export { pickerGroups } from './PlatformCoursePicker'

/**
 * Course settings → LMS (M09 §7.1): which course on the platform this one is and whether its
 * calendar and assignment changes show up; or, without a link, a searchable picker and the
 * course's materials settings, so they can be chosen before the first sync.
 */
export function CourseLmsSection({ scope }: SettingsSectionProps) {
  const courseId = scope?.kind === 'course' ? scope.courseId : ''
  const programId = scope?.programId ?? ''
  const state = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } }))
  // Names the connection the list comes from (a student may have several).
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } }))
  const [changing, setChanging] = useState(false)
  const provider = useProviderName(binding.data?.connection?.provider) ?? m.lms_name()

  return (
    <AsyncBoundary query={state}>
      {(data) => {
        if (!data.program_connection_id) return <ProgramUnbound programId={programId} />
        const connection = binding.data?.connection?.display_name ?? null
        if (data.link && !changing) {
          return (
            <LinkedCourse
              link={data.link}
              materials={data.materials ?? null}
              scope={scope}
              courseId={courseId}
              connection={binding.data?.connection ?? null}
              onChange={() => setChanging(true)}
            />
          )
        }
        return (
          <div className="space-y-6">
            <CoursePicker
              programId={programId}
              courseId={courseId}
              connection={connection}
              current={data.link}
              onDone={() => setChanging(false)}
            />
            {data.link ? null : (
              // Chosen before linking: the first sync starts as soon as the course is linked.
              <SettingsBlock
                title={m.lms_materials_group()}
                description={m.lms_course_materials_before_link()}
              >
                <NamespaceForm
                  namespace={MATERIALS}
                  level="course"
                  scope={scope}
                  fields={MATERIAL_FIELDS}
                  params={{ provider }}
                />
              </SettingsBlock>
            )}
          </div>
        )
      }}
    </AsyncBoundary>
  )
}

/**
 * The Program has no connection yet. With connections in the account, one can be chosen here for
 * the Program (the way the course links); without any, the way out is adding one.
 */
function ProgramUnbound({ programId }: { programId: string }) {
  const openConnections = useOpenConnections()
  const connections = useQuery(lmsConnectionListOptions())
  const binding = useProgramBinding(programId)
  return (
    <AsyncBoundary
      query={connections}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2 aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.lms_connections_empty()}</EmptyTitle>
            <EmptyDescription>{m.lms_course_needs_connection()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={openConnections}>
              {m.lms_connection_add()}
            </Button>
          </EmptyContent>
        </Empty>
      }
    >
      {(data) => (
        <SettingsBlock
          title={m.lms_course_unbound_title()}
          description={m.lms_course_unbound_hint()}
        >
          <SettingsGroup>
            {data.items.map((connection) => (
              <ConnectionItem key={connection.id} connection={connection}>
                <Button
                  size="sm"
                  disabled={binding.pending}
                  onClick={() => binding.bind(connection.id)}
                >
                  {m.lms_course_use_connection()}
                </Button>
              </ConnectionItem>
            ))}
          </SettingsGroup>
        </SettingsBlock>
      )}
    </AsyncBoundary>
  )
}

function LinkedCourse({
  link,
  materials,
  scope,
  courseId,
  connection,
  onChange,
}: {
  link: CourseLink
  /** The course's materials by where they are kept, for what unlinking does to them. */
  materials: MaterialCounts | null
  scope: SettingsSectionProps['scope']
  courseId: string
  connection: Connection | null
  onChange: () => void
}) {
  const queryClient = useQueryClient()
  const syncId = useId()
  const now = useNow()
  const openConnections = useOpenConnections()
  // A connection that needs reconnecting stops every course's sync (M09 表 5c, row 1): told
  // before how the course's last sync went, which says nothing of it.
  const broken =
    connection && (connection.status === 'error' || !connection.has_credentials) ? connection : null
  const Logo = useProviderUis().get(link.provider)?.logo ?? Link2
  const provider = useProviderName(link.provider) ?? link.provider
  const [unlinking, setUnlinking] = useState(false)
  // Each change answers with the course's link as it now is; what else it changes (the
  // Program's lists of links, the sync) follows its event.
  const show = (state: CourseLinkState) =>
    queryClient.setQueryData(lmsCourseLinkGetQueryKey({ path: { course_id: courseId } }), state)
  const update = useMutation({
    ...lmsCourseLinkUpdateMutation(),
    onSuccess: show,
    onError: toastError,
  })
  // Runs in the background; the sync's status line and reminders tell how it went.
  const sync = useMutation({
    ...lmsSyncRequestMutation(),
    onError: toastError,
  })
  const syncNow = () =>
    sync.mutate({
      path: { program_id: link.program_id },
      body: { course_id: courseId, force: true },
    })
  const remove = useMutation({
    ...lmsCourseLinkDeleteMutation(),
    onSuccess: (state) => {
      setUnlinking(false)
      show(state)
    },
    onError: (err) => (setUnlinking(false), toastError(err)),
  })
  const title = externalLabel({ code: link.external_code, name: link.external_name ?? '' })

  return (
    <div className="space-y-3">
      <SettingsGroup>
        <Item>
          <ItemMedia>
            <LogoTile logo={Logo} />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="w-full">
              <span className="truncate">{title}</span>
            </ItemTitle>
            <ItemDescription className="truncate">
              {[link.external_term, connection?.display_name ?? provider]
                .filter(Boolean)
                .join(' · ')}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="shrink-0 gap-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {/* The last sync (M09 表 5c): what the sync panel tells of this course. */}
              {broken ? (
                <ConnectionStatus connection={broken} />
              ) : link.sync_state === 'failed' ? (
                <Badge variant="destructive">{m.lms_link_failed()}</Badge>
              ) : link.sync_state === 'stale' ? (
                <Badge variant="secondary">{m.lms_link_stale()}</Badge>
              ) : (
                <Badge variant="secondary">{m.lms_connection_ok()}</Badge>
              )}
              {/* When it last synced: next to a problem it would read as when it broke. */}
              {link.synced_at && link.sync_state === 'ok' && !broken
                ? syncedAgo(link.synced_at, now)
                : null}
            </span>
            {link.web_url ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      aria-label={m.lms_open_in({ provider })}
                      nativeButton={false}
                      render={
                        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Button gives it its aria-label
                        <a href={link.web_url} target="_blank" rel="noreferrer" />
                      }
                    />
                  }
                >
                  <ExternalLink aria-hidden />
                </TooltipTrigger>
                <TooltipContent>{m.lms_open_in({ provider })}</TooltipContent>
              </Tooltip>
            ) : null}
            <RowMenu label={m.lms_course_actions({ course: title })}>
              <DropdownMenuItem disabled={sync.isPending} onClick={syncNow}>
                <RefreshCw aria-hidden />
                {m.lms_sync_now()}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onChange}>
                <Link2 aria-hidden />
                {m.lms_course_change_menu()}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setUnlinking(true)}>
                <Link2Off aria-hidden />
                {m.lms_course_unlink_menu()}
              </DropdownMenuItem>
            </RowMenu>
          </ItemActions>
        </Item>
        <SettingRow
          label={m.lms_course_sync()}
          description={m.lms_course_sync_description({ provider })}
          htmlFor={syncId}
        >
          <Switch
            id={syncId}
            checked={link.sync_enabled}
            disabled={update.isPending}
            onCheckedChange={(on) =>
              update.mutate({ path: { course_id: courseId }, body: { sync_enabled: on } })
            }
          />
        </SettingRow>
      </SettingsGroup>
      {broken ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{m.lms_sync_hint_reconnect({ provider })}</AlertTitle>
          <AlertDescription>
            {errorMessage({
              error: { code: broken.last_error_code ?? 'lms.credentials_missing', params: {} },
            })}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={openConnections}>
              {m.lms_sync_reconnect()}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {link.sync_enabled ? (
        <SettingsBlock title={m.lms_materials_group()}>
          <NamespaceForm
            namespace={MATERIALS}
            level="course"
            scope={scope}
            fields={MATERIAL_FIELDS}
            params={{ provider }}
          />
          <HeldMaterials courseId={courseId} provider={provider} />
        </SettingsBlock>
      ) : null}
      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title={m.lms_course_unlink_title()}
        description={m.lms_course_unlink_desc()}
        extra={materials ? <UnlinkMaterials counts={materials} provider={provider} /> : undefined}
        confirmLabel={m.lms_course_unlink()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ path: { course_id: courseId } })}
      />
    </div>
  )
}

/**
 * Links the course to a platform course from one searchable list; a course whose code matches is
 * suggested under it, apart from the setting so it does not read as one. Moving an existing link
 * drops the tracking of what was imported through it, so that is confirmed first.
 */
function CoursePicker({
  programId,
  courseId,
  connection,
  current,
  onDone,
}: {
  programId: string
  courseId: string
  connection: string | null
  current: CourseLink | null
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const replacing = useDialogTarget<ExternalCourse>()
  const course = useQuery(academicsCourseGetOptions({ path: { course_id: courseId } })).data
  const all = useQuery({
    ...lmsCourseListOptions({ path: { program_id: programId }, query: { include_past: true } }),
    enabled: current === null,
  })
  const provider = useProviderName(all.data?.provider) ?? m.lms_name()
  const link = useMutation({
    ...lmsCourseLinkSetMutation(),
    onSuccess: (state) => {
      replacing.close()
      // The course's link at once; the rest follows `lms.course.linked`.
      queryClient.setQueryData(lmsCourseLinkGetQueryKey({ path: { course_id: courseId } }), state)
      toast.success(m.lms_course_linked())
      onDone()
    },
    onError: (err) => (replacing.close(), toastError(err)),
  })
  const submit = (chosen: ExternalCourse) =>
    link.mutate({
      path: { course_id: courseId },
      // Changing an existing link was confirmed in the dialog below.
      body: { external_course_id: chosen.external_id, replace: current !== null },
    })
  const suggestion =
    current === null && course ? suggestLinks([course], all.data?.items ?? []).get(courseId) : null

  // The suggestion goes under the picker: wait for it, so what follows doesn't move down after.
  if (current === null && all.isPending) return <Skeleton className="h-16 rounded-2xl" />

  return (
    <div className="space-y-3">
      <SettingsGroup>
        <SettingRow
          label={current ? m.lms_course_change_to() : m.lms_course_pick({ provider })}
          description={
            current
              ? undefined
              : connection
                ? m.lms_course_pick_from({ connection })
                : m.lms_course_pick_description({ provider })
          }
        >
          {(labelId) => (
            <div className="flex items-center gap-2">
              {current ? (
                <Button variant="ghost" size="sm" onClick={onDone}>
                  {m.common_cancel()}
                </Button>
              ) : null}
              <PlatformCoursePicker
                programId={programId}
                courseId={courseId}
                courseCode={course?.code}
                currentId={current?.external_course_id}
                labelId={labelId}
                disabled={link.isPending}
                onPick={(chosen) => (current ? replacing.show(chosen) : submit(chosen))}
                className="w-full sm:w-72"
              />
            </div>
          )}
        </SettingRow>
      </SettingsGroup>
      {suggestion ? (
        <Alert>
          <Lightbulb aria-hidden />
          <AlertTitle>
            {m.lms_course_suggestion({ provider, course: externalLabel(suggestion) })}
          </AlertTitle>
          <AlertDescription>
            {[suggestion.term, m.lms_course_suggestion_why()].filter(Boolean).join(' · ')}
          </AlertDescription>
          <AlertAction>
            <Button size="sm" disabled={link.isPending} onClick={() => submit(suggestion)}>
              {m.lms_course_link()}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <ConfirmDialog
        {...replacing.props}
        title={m.lms_course_change_title()}
        description={m.lms_course_change_desc()}
        confirmLabel={m.lms_course_change()}
        pending={link.isPending}
        onConfirm={() => (replacing.target ? submit(replacing.target) : undefined)}
      />
    </div>
  )
}
