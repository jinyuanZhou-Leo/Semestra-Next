import type { Course, OneOffEvent, Section } from '@semestra/api-client'
import {
  scheduleExceptionDeleteMutation,
  scheduleMeetingSetEnabledMutation,
  scheduleSectionDeleteMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarOff,
  CalendarPlus,
  CalendarX2,
  ChevronDown,
  Import,
  Plus,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ImportSourceItems } from '@/components/ImportSourceItems'
import { useDialogTarget } from '@/lib/dialog-target'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { EventDialog } from '../components/EventDialog'
import { EventsTable } from '../components/EventsTable'
import { ExceptionDialog } from '../components/ExceptionDialog'
import { ExceptionsTable } from '../components/ExceptionsTable'
import { MeetingDialog } from '../components/MeetingDialog'
import { SectionsTable, sortSections } from '../components/SectionsTable'
import { SectionDialog } from '../components/SectionDialog'
import { meetingGridItems, useConflictingIds } from '../components/TimetableView'
import { WeekGrid, minutes, weekDays } from '../components/WeekGrid'
import { useProgramTimezone } from '../hooks'
import { sectionLabel } from '../labels'
import { type SectionTime, sectionTimes } from '../sections'
import { todayIn } from '../time'
import {
  invalidateSchedule,
  useCalendarSettingsState,
  useEvents,
  useEventTypes,
  useSections,
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
  const sections = useSections(course.id, termId).data?.items ?? []
  const types = useEventTypes(programId).data?.items ?? []
  const events = (useEvents(programId, { course_id: course.id }).data?.items ?? []).filter(
    (e) => !e.term_id || e.term_id === termId,
  )
  const conflicting = useConflictingIds(termId)
  const importers = useExtensions<MeetingImportSource>(MEETING_IMPORT_SOURCES)
  const launchImport = (source: MeetingImportSource) =>
    void source
      .launch({ programId, courseId: course.id, termId })
      .then(() => invalidateSchedule(queryClient))
      .catch(toastError)
  const editing = useDialogTarget<SectionTime>()
  const eventEdit = useDialogTarget<OneOffEvent | 'new'>()
  const exceptionAdd = useDialogTarget<true>()
  const sectionAdd = useDialogTarget<true>()
  const sectionEdit = useDialogTarget<{ section: Section; withNewTime: boolean }>()
  const sectionDelete = useDialogTarget<Section>()
  const removeSection = useMutation({
    ...scheduleSectionDeleteMutation(),
    onError: toastError,
    onSuccess: () => sectionDelete.close(),
    onSettled: () => invalidateSchedule(queryClient),
  })

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

  const exceptions = sectionTimes(sections)
    .flatMap(({ section, meeting }) => meeting.exceptions.map((exc) => ({ section, meeting, exc })))
    .toSorted((a, b) => a.exc.original_date.localeCompare(b.exc.original_date))

  // The classes that can be cancelled or moved: switched-on times, in the tables' order.
  const enabled = sortSections(sections, types).flatMap((section) =>
    sectionTimes([section])
      .filter(({ meeting }) => meeting.enabled)
      .toSorted(
        (a, b) =>
          a.meeting.weekday - b.meeting.weekday ||
          a.meeting.start_time.localeCompare(b.meeting.start_time),
      ),
  )
  // The whole week and day of the Program's calendar settings; the grid widens for classes
  // outside them.
  const { settings: calendar, isPending: calendarPending } = useCalendarSettingsState(termId)
  const gridItems = meetingGridItems(enabled, [course], conflicting, editing.show, {
    bySection: true,
  })

  const importMenu =
    importers.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
          <Import aria-hidden />
          {m.common_add_from_sources()}
          <ChevronDown aria-hidden data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <ImportSourceItems sources={importers} onPick={launchImport} />
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  return (
    <div className="space-y-10">
      <section aria-labelledby={`${termId}-meetings`} className="space-y-3">
        <SectionHeader
          id={`${termId}-meetings`}
          title={m.schedule_meetings()}
          description={m.schedule_meetings_hint()}
        >
          {importMenu}
          {sections.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => sectionAdd.show(true)}>
              <Plus aria-hidden />
              {m.schedule_section_new_title()}
            </Button>
          ) : null}
        </SectionHeader>
        {sections.length === 0 ? (
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarClock aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.schedule_meetings_empty()}</EmptyTitle>
              <EmptyDescription>{m.schedule_meetings_empty_description()}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => sectionAdd.show(true)}>
                <Plus aria-hidden />
                {m.schedule_section_new_title()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
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
              <section
                aria-label={m.schedule_week_view()}
                className="rounded-2xl border border-border p-3 pt-2"
              >
                {calendarPending ? (
                  // The default 08:00–22:00 grid's height, so the page does not jump when the
                  // Program's own hours arrive.
                  <div aria-hidden className="h-[calc(14*44px+3.5rem)]" />
                ) : (
                  <WeekGrid
                    days={weekDays(
                      calendar.show_weekends || enabled.some(({ meeting }) => meeting.weekday >= 6),
                    )}
                    items={gridItems}
                    dayStart={minutes(calendar.day_start)}
                    dayEnd={minutes(calendar.day_end)}
                    hourHeight={44}
                  />
                )}
              </section>
            )}
            <SectionsTable
              types={types}
              sections={sections}
              conflicting={conflicting}
              busy={setEnabled.isPending}
              onToggle={toggle}
              onKeepOnly={keepOnly}
              onEdit={(section, meeting) => editing.show({ section, meeting })}
              onEditSection={(section, withNewTime) => sectionEdit.show({ section, withNewTime })}
              onDeleteSection={sectionDelete.show}
            />
          </>
        )}
      </section>

      <section aria-labelledby={`${termId}-events`} className="space-y-3">
        <SectionHeader
          id={`${termId}-events`}
          title={m.schedule_events()}
          description={m.schedule_events_hint()}
        >
          {events.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => eventEdit.show('new')}>
              <Plus aria-hidden />
              {m.schedule_event_add()}
            </Button>
          ) : null}
        </SectionHeader>
        {events.length === 0 ? (
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarPlus aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.schedule_events_empty_title()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="link" onClick={() => eventEdit.show('new')}>
                {m.schedule_event_add()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <EventsTable events={events} types={types} timezone={timezone} onEdit={eventEdit.show} />
        )}
      </section>

      {sections.length > 0 || exceptions.length > 0 ? (
        <section aria-labelledby={`${termId}-exceptions`} className="space-y-3">
          <SectionHeader
            id={`${termId}-exceptions`}
            title={m.schedule_exceptions()}
            description={m.schedule_exceptions_hint()}
          >
            {exceptions.length > 0 && enabled.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => exceptionAdd.show(true)}>
                <Plus aria-hidden />
                {m.schedule_exception_add()}
              </Button>
            ) : null}
          </SectionHeader>
          {exceptions.length === 0 ? (
            <Empty className="rounded-2xl border border-solid border-border p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarX2 aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.schedule_exceptions_empty()}</EmptyTitle>
              </EmptyHeader>
              {enabled.length > 0 ? (
                <EmptyContent>
                  <Button size="sm" variant="link" onClick={() => exceptionAdd.show(true)}>
                    {m.schedule_exception_add()}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ExceptionsTable
              exceptions={exceptions}
              busy={restore.isPending}
              onRestore={(meeting, exc) =>
                restore.mutate({
                  path: { meeting_id: meeting.id, original_date: exc.original_date },
                })
              }
            />
          )}
        </section>
      ) : null}

      {editing.target ? (
        <MeetingDialog
          key={editing.target.meeting.id}
          section={editing.target.section}
          meeting={editing.target.meeting}
          {...editing.props}
        />
      ) : null}
      {sectionAdd.target ? (
        <SectionDialog
          programId={programId}
          courseId={course.id}
          termId={termId}
          typeCode={types[0]?.code ?? 'LEC'}
          {...sectionAdd.props}
        />
      ) : null}
      {sectionEdit.target ? (
        <SectionDialog
          key={sectionEdit.target.section.id}
          programId={programId}
          courseId={course.id}
          termId={termId}
          typeCode={sectionEdit.target.section.type_code}
          section={sectionEdit.target.section}
          withNewTime={sectionEdit.target.withNewTime}
          {...sectionEdit.props}
        />
      ) : null}
      <ConfirmDialog
        {...sectionDelete.props}
        title={m.schedule_section_delete_title({
          section: sectionDelete.target ? sectionLabel(sectionDelete.target) : '',
        })}
        description={m.schedule_section_delete_description()}
        confirmLabel={m.schedule_section_delete()}
        pending={removeSection.isPending}
        onConfirm={() =>
          sectionDelete.target &&
          removeSection.mutate({ path: { section_id: sectionDelete.target.id } })
        }
      />
      {exceptionAdd.target ? (
        <ExceptionDialog
          programId={programId}
          courseId={course.id}
          termId={termId}
          today={todayIn(timezone)}
          times={enabled}
          {...exceptionAdd.props}
        />
      ) : null}
      {eventEdit.target ? (
        <EventDialog
          programId={programId}
          timezone={timezone}
          termId={termId}
          courseId={course.id}
          event={eventEdit.target === 'new' ? undefined : eventEdit.target}
          {...eventEdit.props}
        />
      ) : null}
    </div>
  )
}

/** A section's title and what it holds, with the section's own add buttons on the right. */
function SectionHeader({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h3 id={id} className="font-heading text-base font-medium">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  )
}
