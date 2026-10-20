import type { CourseLink } from '@semestra/api-client'
import {
  lmsCourseLinkDeleteMutation,
  lmsCourseLinkGetOptions,
  lmsCourseLinkSetMutation,
  lmsCourseLinkSyncMutation,
  lmsCourseLinkUpdateMutation,
  lmsCourseListOptions,
} from '@semestra/api-client/react-query'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Link2, Link2Off, RefreshCw } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import type { SettingsSectionProps } from '@/app/extensions'
import { ActionRow, SettingRow, SettingsGroup, useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Switch } from '@/ui/switch'
import { externalLabel, groupByTerm } from '../external'
import { useProviderName, useProviderUis } from '../providers'
import { invalidateLms } from '../queries'

/**
 * Course settings → LMS (M09 §7.1): which course on the platform this one is, whether its
 * content is synced (calendar, updates) and "Sync now"; or, without a link, the picker.
 */
export function CourseLmsSection({ scope }: SettingsSectionProps) {
  const courseId = scope?.kind === 'course' ? scope.courseId : ''
  const programId = scope?.programId ?? ''
  const settings = useSettingsDialog()
  const state = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } }))
  const [changing, setChanging] = useState(false)

  return (
    <AsyncBoundary query={state}>
      {(data) => {
        if (!data.program_connection_id) {
          return (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Link2 aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.lms_course_program_unbound()}</EmptyTitle>
                <EmptyDescription>{m.lms_course_program_unbound_hint()}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  size="sm"
                  onClick={() => settings.open({ level: 'program', group: 'integrations' })}
                >
                  {m.lms_course_open_program_settings()}
                </Button>
              </EmptyContent>
            </Empty>
          )
        }
        if (data.link && !changing) {
          return (
            <LinkedCourse link={data.link} courseId={courseId} onChange={() => setChanging(true)} />
          )
        }
        return (
          <CoursePicker
            programId={programId}
            courseId={courseId}
            current={data.link}
            onDone={() => setChanging(false)}
          />
        )
      }}
    </AsyncBoundary>
  )
}

function LinkedCourse({
  link,
  courseId,
  onChange,
}: {
  link: CourseLink
  courseId: string
  onChange: () => void
}) {
  const queryClient = useQueryClient()
  const syncId = useId()
  const ui = useProviderUis().get(link.provider)
  const provider = useProviderName(link.provider) ?? link.provider
  const Logo = ui?.logo ?? Link2
  const [unlinking, setUnlinking] = useState(false)
  const refresh = () => invalidateLms(queryClient)
  const update = useMutation({
    ...lmsCourseLinkUpdateMutation(),
    onSuccess: refresh,
    onError: toastError,
  })
  const sync = useMutation({
    ...lmsCourseLinkSyncMutation(),
    onSuccess: async (out) => {
      await queryClient.invalidateQueries()
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
      await queryClient.invalidateQueries()
    },
    onError: (err) => (setUnlinking(false), toastError(err)),
  })
  const status = link.last_error_code
    ? errorMessage({ error: { code: link.last_error_code } })
    : link.last_synced_at
      ? m.lms_course_synced_at({ time: formatDateTime(link.last_synced_at) })
      : m.lms_course_never_synced()

  return (
    <>
      <SettingsGroup>
        <Item>
          <ItemMedia variant="icon">
            <Logo aria-hidden className="size-5 text-muted-foreground" />
          </ItemMedia>
          <ItemContent className="min-w-0 basis-56">
            <ItemTitle>
              <span className="truncate">
                {externalLabel({ code: link.external_code, name: link.external_name ?? '' })}
              </span>
            </ItemTitle>
            <ItemDescription className="truncate">
              {[provider, link.external_term].filter(Boolean).join(' · ')}
            </ItemDescription>
            <ItemDescription className={link.last_error_code ? 'text-destructive' : undefined}>
              {status}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="shrink-0">
            {link.web_url ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Button's children label it
                  <a href={link.web_url} target="_blank" rel="noreferrer" />
                }
                nativeButton={false}
              >
                <ExternalLink aria-hidden />
                {m.lms_open_in({ provider })}
              </Button>
            ) : null}
          </ItemActions>
        </Item>
        <SettingRow
          label={m.lms_course_sync()}
          description={m.lms_course_sync_description()}
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
        <ActionRow
          icon={RefreshCw}
          disabled={sync.isPending}
          onClick={() => sync.mutate({ path: { course_id: courseId } })}
        >
          {sync.isPending ? m.lms_course_syncing() : m.lms_course_sync_now()}
        </ActionRow>
        <ActionRow icon={Link2} onClick={onChange}>
          {m.lms_course_change()}
        </ActionRow>
        <ActionRow icon={Link2Off} destructive onClick={() => setUnlinking(true)}>
          {m.lms_course_unlink()}
        </ActionRow>
      </SettingsGroup>
      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title={m.lms_course_unlink_title()}
        description={m.lms_course_unlink_desc()}
        confirmLabel={m.lms_course_unlink()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ path: { course_id: courseId } })}
      />
    </>
  )
}

/** External courses by term; ones another course links are disabled and say which course. */
function CoursePicker({
  programId,
  courseId,
  current,
  onDone,
}: {
  programId: string
  courseId: string
  current: CourseLink | null
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const id = useId()
  const [past, setPast] = useState(false)
  const [chosen, setChosen] = useState(current?.external_course_id ?? '')
  const [confirming, setConfirming] = useState(false)
  // Keeps the list while "Show past courses" refetches, so the section does not jump.
  const courses = useQuery({
    ...lmsCourseListOptions({ path: { program_id: programId }, query: { include_past: past } }),
    placeholderData: keepPreviousData,
  })
  const provider = useProviderName(courses.data?.provider) ?? m.lms_name()
  const link = useMutation({
    ...lmsCourseLinkSetMutation(),
    onSuccess: async () => {
      setConfirming(false)
      await queryClient.invalidateQueries()
      onDone()
    },
    onError: (err) => (setConfirming(false), toastError(err)),
  })
  const submit = () =>
    link.mutate({ path: { course_id: courseId }, body: { external_course_id: chosen } })

  return (
    <AsyncBoundary query={courses}>
      {(data) => {
        const groups = groupByTerm(data.items)
        const items = data.items.map((c) => ({ value: c.external_id, label: externalLabel(c) }))
        return (
          <>
            <SettingsGroup>
              <SettingRow
                label={m.lms_course_pick({ provider })}
                description={m.lms_course_pick_description({ provider })}
              >
                {(labelId) =>
                  data.items.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {m.lms_courses_empty({ provider })}
                    </span>
                  ) : (
                    <Select
                      value={chosen || null}
                      items={items}
                      onValueChange={(v) => setChosen(v ?? '')}
                    >
                      <SelectTrigger aria-labelledby={labelId} className="w-64">
                        <SelectValue placeholder={m.lms_course_pick_placeholder()} />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map((group) => (
                          <SelectGroup key={group.term}>
                            <SelectLabel>{group.term}</SelectLabel>
                            {group.courses.map((c) => {
                              const elsewhere =
                                c.linked_course_id && c.linked_course_id !== courseId
                              return (
                                <SelectItem
                                  key={c.external_id}
                                  value={c.external_id}
                                  disabled={Boolean(elsewhere)}
                                >
                                  {externalLabel(c)}
                                  {elsewhere ? (
                                    <span className="text-xs text-muted-foreground">
                                      {m.lms_course_linked_to({
                                        course: c.linked_course_name ?? '',
                                      })}
                                    </span>
                                  ) : null}
                                </SelectItem>
                              )
                            })}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                }
              </SettingRow>
              <Item>
                <ItemContent>
                  <Field orientation="horizontal" className="w-fit">
                    <Switch id={`${id}-past`} checked={past} onCheckedChange={setPast} />
                    <FieldLabel htmlFor={`${id}-past`} className="font-normal">
                      {m.lms_show_past()}
                    </FieldLabel>
                  </Field>
                </ItemContent>
                <ItemActions>
                  {current ? (
                    <Button variant="outline" size="sm" onClick={onDone}>
                      {m.common_cancel()}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={!chosen || chosen === current?.external_course_id || link.isPending}
                    // Moving the link drops what was imported through it: say so first.
                    onClick={() => (current ? setConfirming(true) : submit())}
                  >
                    {m.lms_course_link()}
                  </Button>
                </ItemActions>
              </Item>
            </SettingsGroup>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={m.lms_course_change_title()}
              description={m.lms_course_change_desc()}
              confirmLabel={m.lms_course_change()}
              pending={link.isPending}
              onConfirm={submit}
            />
          </>
        )
      }}
    </AsyncBoundary>
  )
}
