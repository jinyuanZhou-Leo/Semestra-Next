import type { CourseLink, ExternalCourse } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  lmsConnectionListOptions,
  lmsCourseLinkDeleteMutation,
  lmsCourseLinkGetOptions,
  lmsCourseLinkSetMutation,
  lmsCourseLinkSyncMutation,
  lmsCourseLinkUpdateMutation,
  lmsCourseListOptions,
  lmsProgramBindingGetOptions,
} from '@semestra/api-client/react-query'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Link2, Link2Off, RefreshCw, TriangleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import type { SettingsSectionProps } from '@/app/extensions'
import { RowMenu, SettingRow, SettingsGroup, useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toastError } from '@/lib/errors'
import { formatTimeAgo } from '@/lib/format'
import { useNow } from '@/lib/now'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from '@/ui/combobox'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Field, FieldLabel } from '@/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Switch } from '@/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { externalLabel, groupByTerm } from '../external'
import { useProviderName, useProviderUis } from '../providers'
import { invalidateLms } from '../queries'
import { ERROR_LABEL, LogoTile } from './ConnectionsSection'
import { useOpenConnections } from './ProgramLmsSection'

/** Link errors that only a new token (or new permissions) on the connection fixes. */
const CONNECTION_ERRORS = new Set([
  'lms.invalid_credentials',
  'lms.credentials_missing',
  'lms.forbidden',
])

/**
 * Course settings → LMS (M09 §7.1): which course on the platform this one is and whether its
 * calendar and assignment changes show up; or, without a link, a searchable picker.
 */
export function CourseLmsSection({ scope }: SettingsSectionProps) {
  const courseId = scope?.kind === 'course' ? scope.courseId : ''
  const programId = scope?.programId ?? ''
  const state = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } }))
  // Names the connection the list comes from (a student may have several).
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } }))
  const [changing, setChanging] = useState(false)

  return (
    <AsyncBoundary query={state}>
      {(data) => {
        if (!data.program_connection_id) return <ProgramUnbound />
        const connection = binding.data?.connection?.display_name ?? null
        if (data.link && !changing) {
          return (
            <LinkedCourse
              link={data.link}
              courseId={courseId}
              connection={connection}
              onChange={() => setChanging(true)}
            />
          )
        }
        return (
          <CoursePicker
            programId={programId}
            courseId={courseId}
            connection={connection}
            current={data.link}
            onDone={() => setChanging(false)}
          />
        )
      }}
    </AsyncBoundary>
  )
}

/** Without any connection the way out is adding one, not a detour through the Program. */
function ProgramUnbound() {
  const settings = useSettingsDialog()
  const openConnections = useOpenConnections()
  const connections = useQuery(lmsConnectionListOptions())
  return (
    <AsyncBoundary query={connections}>
      {(data) => {
        const none = data.items.length === 0
        return (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2 aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                {none ? m.lms_connections_empty() : m.lms_course_program_unbound()}
              </EmptyTitle>
              <EmptyDescription>
                {none ? m.lms_course_needs_connection() : m.lms_course_program_unbound_hint()}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="sm"
                onClick={
                  none
                    ? openConnections
                    : () => settings.open({ level: 'program', group: 'integrations' })
                }
              >
                {none ? m.lms_connection_add() : m.lms_course_open_program_settings()}
              </Button>
            </EmptyContent>
          </Empty>
        )
      }}
    </AsyncBoundary>
  )
}

function LinkedCourse({
  link,
  courseId,
  connection,
  onChange,
}: {
  link: CourseLink
  courseId: string
  connection: string | null
  onChange: () => void
}) {
  const queryClient = useQueryClient()
  const syncId = useId()
  const now = useNow()
  const openConnections = useOpenConnections()
  const Logo = useProviderUis().get(link.provider)?.logo ?? Link2
  const provider = useProviderName(link.provider) ?? link.provider
  const [unlinking, setUnlinking] = useState(false)
  const refresh = () => invalidateLms(queryClient, { courseId })
  const update = useMutation({
    ...lmsCourseLinkUpdateMutation(),
    onSuccess: refresh,
    onError: toastError,
  })
  const sync = useMutation({
    ...lmsCourseLinkSyncMutation(),
    onSuccess: async (out) => {
      // Only the link's own details change (its content stays cached).
      await refresh()
      const code = out.link?.last_error_code
      if (code) toast.error(errorMessage({ error: { code } }))
      else toast.success(m.lms_course_synced())
    },
    onError: toastError,
  })
  const remove = useMutation({
    ...lmsCourseLinkDeleteMutation(),
    onSuccess: async () => {
      setUnlinking(false)
      await invalidateLms(queryClient, { courseId })
    },
    onError: (err) => (setUnlinking(false), toastError(err)),
  })
  const code = link.last_error_code
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
              {[link.external_term, connection ?? provider].filter(Boolean).join(' · ')}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="shrink-0 gap-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {code ? (
                <Badge variant="destructive">{ERROR_LABEL[code]?.() ?? m.lms_status_error()}</Badge>
              ) : (
                <Badge variant="secondary">{m.lms_connection_ok()}</Badge>
              )}
              {/* The last successful refresh: next to an error it would read as when it broke. */}
              {link.last_synced_at && !code ? formatTimeAgo(link.last_synced_at, now) : null}
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
              <DropdownMenuItem
                disabled={sync.isPending}
                onClick={() => sync.mutate({ path: { course_id: courseId } })}
              >
                <RefreshCw aria-hidden />
                {m.lms_course_sync_now()}
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
      {code ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{m.lms_course_error_title({ provider })}</AlertTitle>
          <AlertDescription>{errorMessage({ error: { code } })}</AlertDescription>
          <AlertAction>
            {CONNECTION_ERRORS.has(code) ? (
              <Button size="sm" variant="outline" onClick={openConnections}>
                {m.lms_course_open_connections()}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={sync.isPending}
                onClick={() => sync.mutate({ path: { course_id: courseId } })}
              >
                {m.common_retry()}
              </Button>
            )}
          </AlertAction>
        </Alert>
      ) : null}
      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title={m.lms_course_unlink_title()}
        description={m.lms_course_unlink_desc()}
        confirmLabel={m.lms_course_unlink()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ path: { course_id: courseId } })}
      />
    </div>
  )
}

type PickerGroup = { id: string; label: string; items: ExternalCourse[] }

const normalizeCode = (code: string | null | undefined) =>
  (code ?? '').replace(/\s+/g, '').toUpperCase()

/**
 * Suggested first (platform courses whose code starts with this course's), then by term.
 * A suggested course is not listed again under its term.
 */
export function pickerGroups(
  items: ExternalCourse[],
  courseCode: string | null | undefined,
  courseId: string,
  currentId?: string,
): PickerGroup[] {
  const code = normalizeCode(courseCode)
  const suggested =
    code.length >= 3
      ? items.filter(
          (c) =>
            normalizeCode(c.code).startsWith(code) &&
            c.external_id !== currentId &&
            (!c.linked_course_id || c.linked_course_id === courseId),
        )
      : []
  const shown = new Set(suggested.map((c) => c.external_id))
  const groups: PickerGroup[] = suggested.length
    ? [{ id: 'suggested', label: m.lms_course_suggested(), items: suggested }]
    : []
  for (const group of groupByTerm(items.filter((c) => !shown.has(c.external_id)))) {
    groups.push({ id: group.term, label: group.term, items: group.courses })
  }
  return groups
}

/**
 * One searchable list of the platform's courses. Picking a course links it; moving an existing
 * link drops the tracking of what was imported through it, so that is confirmed first.
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
  const pastId = useId()
  const [past, setPast] = useState(false)
  const [replacing, setReplacing] = useState<ExternalCourse | null>(null)
  const course = useQuery(academicsCourseGetOptions({ path: { course_id: courseId } }))
  // Keeps the list while "Include past courses" refetches, so the list does not jump.
  const courses = useQuery({
    ...lmsCourseListOptions({ path: { program_id: programId }, query: { include_past: past } }),
    placeholderData: keepPreviousData,
  })
  const provider = useProviderName(courses.data?.provider) ?? m.lms_name()
  const link = useMutation({
    ...lmsCourseLinkSetMutation(),
    onSuccess: async () => {
      setReplacing(null)
      await invalidateLms(queryClient, { courseId })
      toast.success(m.lms_course_linked())
      onDone()
    },
    onError: (err) => (setReplacing(null), toastError(err)),
  })
  const submit = (chosen: ExternalCourse) =>
    link.mutate({
      path: { course_id: courseId },
      // Changing an existing link was confirmed in the dialog below.
      body: { external_course_id: chosen.external_id, replace: current !== null },
    })

  return (
    <AsyncBoundary query={courses}>
      {(data) => {
        const groups = pickerGroups(
          data.items,
          course.data?.code,
          courseId,
          current?.external_course_id,
        )
        return (
          <>
            <SettingsGroup>
              <SettingRow
                label={current ? m.lms_course_change_to() : m.lms_course_pick({ provider })}
                description={
                  connection
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
                    <Combobox
                      items={groups}
                      value={null}
                      onValueChange={(chosen: ExternalCourse | null, details) => {
                        // Typing on the closed trigger also selects (typeahead): only a press
                        // on an item (click or Enter) links.
                        if (!chosen || details.reason !== 'item-press') return
                        if (current) setReplacing(chosen)
                        else submit(chosen)
                      }}
                      itemToStringLabel={(c: ExternalCourse) => `${c.code ?? ''} ${c.name}`}
                      isItemEqualToValue={(a: ExternalCourse, b: ExternalCourse) =>
                        a.external_id === b.external_id
                      }
                      disabled={link.isPending}
                    >
                      <ComboboxTrigger
                        aria-labelledby={labelId}
                        render={
                          <Button
                            variant="outline"
                            className="w-full justify-between font-normal sm:w-72"
                          />
                        }
                      >
                        <span className="truncate text-muted-foreground">
                          {m.lms_course_pick_placeholder()}
                        </span>
                      </ComboboxTrigger>
                      <ComboboxContent align="end" className="w-96">
                        <ComboboxInput showTrigger={false} placeholder={m.lms_course_search()} />
                        <ComboboxEmpty>
                          {data.items.length === 0
                            ? m.lms_courses_empty({ provider })
                            : m.lms_course_search_empty()}
                        </ComboboxEmpty>
                        <ComboboxList>
                          {(group: PickerGroup) => (
                            <ComboboxGroup key={group.id} items={group.items}>
                              {group === groups[0] ? null : <ComboboxSeparator />}
                              <ComboboxLabel>{group.label}</ComboboxLabel>
                              <ComboboxCollection>
                                {(c: ExternalCourse) => (
                                  <CourseOption
                                    key={c.external_id}
                                    course={c}
                                    courseId={courseId}
                                    currentId={current?.external_course_id}
                                  />
                                )}
                              </ComboboxCollection>
                            </ComboboxGroup>
                          )}
                        </ComboboxList>
                        <Field orientation="horizontal" className="border-t px-3 py-2">
                          <Checkbox id={pastId} checked={past} onCheckedChange={setPast} />
                          <FieldLabel
                            htmlFor={pastId}
                            className="text-xs font-normal text-muted-foreground"
                          >
                            {m.lms_course_include_past()}
                          </FieldLabel>
                        </Field>
                      </ComboboxContent>
                    </Combobox>
                  </div>
                )}
              </SettingRow>
            </SettingsGroup>
            <ConfirmDialog
              open={replacing !== null}
              onOpenChange={(open) => (open ? undefined : setReplacing(null))}
              title={m.lms_course_change_title()}
              description={m.lms_course_change_desc()}
              confirmLabel={m.lms_course_change()}
              pending={link.isPending}
              onConfirm={() => (replacing ? submit(replacing) : undefined)}
            />
          </>
        )
      }}
    </AsyncBoundary>
  )
}

/** Code over name; the current one, or one linked by another course, is disabled and says so. */
function CourseOption({
  course,
  courseId,
  currentId,
}: {
  course: ExternalCourse
  courseId: string
  currentId?: string
}) {
  const elsewhere = Boolean(course.linked_course_id && course.linked_course_id !== courseId)
  const isCurrent = course.external_id === currentId
  return (
    <ComboboxItem value={course} disabled={elsewhere || isCurrent}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{course.code ?? course.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {isCurrent
            ? m.lms_course_current()
            : elsewhere
              ? m.lms_course_linked_to({ course: course.linked_course_name ?? '' })
              : course.code
                ? course.name
                : course.term}
        </span>
      </span>
    </ComboboxItem>
  )
}
