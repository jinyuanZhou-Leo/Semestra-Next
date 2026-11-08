import type { Course } from '@semestra/api-client'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { sectionLabel } from '../labels'
import { useConflicts } from '../queries'
import type { SectionTime } from '../sections'
import { type GridItem, WeekGrid, minutes, weekDays } from './WeekGrid'

/** Enabled meetings as blocks of the weekly template; conflicting ones get a warning mark. */
export function meetingGridItems(
  times: readonly SectionTime[],
  courses: readonly Course[],
  conflicting: ReadonlySet<string>,
  onClick?: (time: SectionTime) => void,
  { bySection = false }: { bySection?: boolean } = {},
): GridItem[] {
  return times
    .filter(({ meeting }) => meeting.enabled)
    .map((time) => {
      const { section, meeting: mt } = time
      const course = courses.find((c) => c.id === section.course_id)
      const label = course ? courseLabel(course) : ''
      const parts = [
        bySection ? null : section.section_code || null,
        section.recurrence === 'biweekly' ? m.schedule_recurrence_biweekly() : null,
        mt.location,
      ].filter(Boolean)
      return {
        id: mt.id,
        weekday: mt.weekday,
        start: minutes(mt.start_time),
        end: minutes(mt.end_time),
        color: course ? courseColor(course) : 'var(--subject-12)',
        title: bySection ? sectionLabel(section) : `${label} ${section.type_code}`.trim(),
        subtitle: parts.join(' · ') || undefined,
        conflict: conflicting.has(mt.id),
        onClick: onClick ? () => onClick(time) : undefined,
      }
    })
}

/** Ids of meetings in any conflict pair of the term. */
export function useConflictingIds(termId: string): Set<string> {
  const pairs = useConflicts(termId).data?.items ?? []
  return new Set(pairs.flatMap((p) => [p.meeting_id, p.other_meeting_id]))
}

/**
 * The "timetable" view (M04 §5.2): a week without dates showing every enabled meeting of the
 * term; overlapping meetings sit side by side with a warning mark.
 */
export function TimetableView({
  termId,
  times,
  courses,
  dayStart,
  dayEnd,
  showWeekends,
  onEditMeeting,
}: {
  termId: string
  times: readonly SectionTime[]
  courses: readonly Course[]
  dayStart: string
  dayEnd: string
  showWeekends: boolean
  onEditMeeting: (time: SectionTime) => void
}) {
  const conflicting = useConflictingIds(termId)
  return (
    <WeekGrid
      days={weekDays(
        showWeekends || times.some(({ meeting }) => meeting.enabled && meeting.weekday >= 6),
      )}
      items={meetingGridItems(times, courses, conflicting, onEditMeeting)}
      dayStart={minutes(dayStart)}
      dayEnd={minutes(dayEnd)}
      // The calendar's type sizes (FullCalendar's): 13px headers, compact blocks.
      className="text-[0.8125rem] [&_[data-testid=grid-item]]:text-[0.6875rem]"
    />
  )
}
