import type { Course, Meeting, OneOffEvent } from '@semestra/api-client'
import {
  scheduleExceptionDeleteMutation,
  scheduleMeetingSetEnabledMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarOff, CalendarPlus, ChevronDown, Import, Plus } from 'lucide-react'
import { useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { useCourse, useTerms } from '@/modules/academics/queries'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { EventDialog } from '../components/EventDialog'
import { EventsTable } from '../components/EventsTable'
import { ExceptionsTable } from '../components/ExceptionsTable'
import { MeetingDialog } from '../components/MeetingDialog'
import { MeetingGroup } from '../components/MeetingGroup'
import { meetingGridItems, useConflictingIds } from '../components/TimetableView'
import { WeekGrid, minutes, weekDays } from '../components/WeekGrid'
import { useProgramTimezone } from '../hooks'
import {
  invalidateSchedule,
  useCalendarSettingsState,
  useEvents,
  useEventTypes,
  useMeetings,
} from '../queries'
import { MEETING_IMPORT_SOURCES, type MeetingImportSource } from '../types'

/** A course's schedule (M04 §5.3): meetings per term and type, one-off events, exceptions. */
export default function CourseSchedulePage({ scope }: PageProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const course = useCourse(courseId).data
  const terms = useTerms(scope.programId).data?.items ?? []
  const timezone = useProgramTimezone(scope.programId)
  const [tab, setTab] = useState<string | null>(null)
  if (!course || !timezone) return null
  const courseTerms = course.term_ids
    .map((id) => terms.find((t) => t.id === id))
    .filter((t) => t !== undefined)
  const fallback = courseTerms.find((t) => t.is_current)?.id ?? course.term_ids[0] ?? ''
  const active = tab && course.term_ids.includes(tab) ? tab : fallback
  if (courseTerms.length <= 1) {
    return (
      <TermSchedule
        programId={scope.programId}
        course={course}
        termId={active}
        timezone={timezone}
      />
    )
  }
  return (
    <Tabs value={active} onValueChange={(value) => setTab(String(value))}>
      <TabsList>
        {courseTerms.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {courseTerms.map((t) => (
        <TabsContent key={t.id} value={t.id} className="pt-2">
          <TermSchedule
            programId={scope.programId}
            course={course}
            termId={t.id}
            timezone={timezone}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function TermSchedule({
  programId,
  course,
  termId,
  timezone,
}: {
  programId: string
  course: Course
  termId: string
  timezone: string
}) {
  const queryClient = useQueryClient()
  const meetings = useMeetings(course.id, termId).data?.items ?? []
  const types = useEventTypes(programId).data?.items ?? []
  const events = (useEvents(programId, { course_id: course.id }).data?.items ?? []).filter(
    (e) => !e.term_id || e.term_id === termId,
  )
  const conflicting = useConflictingIds(termId)
  const importers = useExtensions<MeetingImportSource>(MEETING_IMPORT_SOURCES)
  const [editing, setEditing] = useState<Meeting | 'new' | null>(null)
  const [eventEdit, setEventEdit] = useState<OneOffEvent | 'new' | null>(null)

  const setEnabled = useMutation({
    ...scheduleMeetingSetEnabledMutation(),
    onError: toastError,
    onSettled: () => invalidateSchedule(queryClient),
  })
  const restore = useMutation({
    ...scheduleExceptionDeleteMutation(),
    onError: toastError,
    onSettled: () => invalidateSchedule(queryClient),
  })
  const toggle = (ids: string[], enabled: boolean) =>
    setEnabled.mutate({ path: { course_id: course.id }, body: { meeting_ids: ids, enabled } })
  const keepOnly = (keep: string[], others: string[]) =>
    setEnabled.mutate({
      path: { course_id: course.id },
      body: { meeting_ids: keep, enabled: true, other_meeting_ids: others },
    })

  const typeCodes = [
    ...types.map((t) => t.code).filter((code) => meetings.some((mt) => mt.type_code === code)),
    ...new Set(
      meetings.map((mt) => mt.type_code).filter((code) => !types.some((t) => t.code === code)),
    ),
  ]
  const exceptions = meetings
    .flatMap((mt) => mt.exceptions.map((exc) => ({ meeting: mt, exc })))
    .toSorted((a, b) => a.exc.original_date.localeCompare(b.exc.original_date))

  const enabled = meetings.filter((mt) => mt.enabled)
  // The whole week and day of the Program's calendar settings; the grid widens for classes
  // outside them.
  const { settings: calendar, isPending: calendarPending } = useCalendarSettingsState(termId)
  const gridItems = meetingGridItems(enabled, [course], conflicting, setEditing, {
    bySection: true,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" />}>
            <Plus aria-hidden />
            {m.schedule_add()}
            <ChevronDown aria-hidden data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setEditing('new')}>
              <CalendarClock aria-hidden />
              {m.schedule_add_meeting()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEventEdit('new')}>
              <CalendarPlus aria-hidden />
              {m.schedule_add_event()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {importers.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              <Import aria-hidden />
              {m.schedule_import()}
              <ChevronDown aria-hidden data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {importers.map((source) => (
                <DropdownMenuItem
                  key={source.id}
                  onClick={() =>
                    void source
                      .launch({ programId, courseId: course.id, termId })
                      .then(() => invalidateSchedule(queryClient))
                      .catch(toastError)
                  }
                >
                  <source.icon aria-hidden />
                  {source.title()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {meetings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.schedule_meetings_empty()}</EmptyTitle>
            <EmptyDescription>{m.schedule_meetings_empty_description()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {m.schedule_meeting_add()}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <section aria-label={m.schedule_week_view()} className="space-y-2">
            <h3 className="text-sm font-medium">{m.schedule_week_view()}</h3>
            {enabled.length === 0 ? (
              <Empty className="rounded-2xl border border-solid border-border p-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarOff aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{m.schedule_meetings_all_disabled()}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="rounded-2xl border border-border p-3 pt-2">
                {calendarPending ? (
                  // The default 08:00–22:00 grid's height, so the page does not jump when the
                  // Program's own hours arrive.
                  <div aria-hidden className="h-[calc(14*44px+3.5rem)]" />
                ) : (
                  <WeekGrid
                    days={weekDays(calendar.show_weekends || enabled.some((mt) => mt.weekday >= 6))}
                    items={gridItems}
                    dayStart={minutes(calendar.day_start)}
                    dayEnd={minutes(calendar.day_end)}
                    hourHeight={44}
                  />
                )}
              </div>
            )}
          </section>
          {typeCodes.map((code) => (
            <MeetingGroup
              key={code}
              type={types.find((t) => t.code === code)}
              code={code}
              meetings={meetings.filter((mt) => mt.type_code === code)}
              conflicting={conflicting}
              busy={setEnabled.isPending}
              onToggle={toggle}
              onKeepOnly={keepOnly}
              onEdit={setEditing}
            />
          ))}
        </>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{m.schedule_events()}</h3>
        {events.length === 0 ? (
          <Empty className="rounded-2xl border border-border border-solid p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarPlus aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.schedule_events_empty_title()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="link" onClick={() => setEventEdit('new')}>
                {m.schedule_event_add()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <EventsTable
            events={events}
            types={types}
            timezone={timezone}
            onEdit={setEventEdit}
            onAdd={() => setEventEdit('new')}
          />
        )}
      </section>

      {exceptions.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{m.schedule_exceptions()}</h3>
          <ExceptionsTable
            exceptions={exceptions}
            busy={restore.isPending}
            onRestore={(meeting, exc) =>
              restore.mutate({ path: { meeting_id: meeting.id, original_date: exc.original_date } })
            }
          />
        </section>
      ) : null}

      {editing ? (
        <MeetingDialog
          key={editing === 'new' ? 'new' : editing.id}
          programId={programId}
          courseId={course.id}
          termIds={course.term_ids}
          termId={termId}
          meeting={editing === 'new' ? undefined : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
      {eventEdit ? (
        <EventDialog
          programId={programId}
          timezone={timezone}
          termId={termId}
          courseId={course.id}
          event={eventEdit === 'new' ? undefined : eventEdit}
          open
          onOpenChange={(open) => !open && setEventEdit(null)}
        />
      ) : null}
    </div>
  )
}
