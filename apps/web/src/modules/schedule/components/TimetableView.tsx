import type { Course, Meeting } from '@semestra/api-client'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { useConflicts } from '../queries'
import { type GridItem, WeekGrid, minutes, weekDays } from './WeekGrid'

/** Enabled meetings as blocks of the weekly template; conflicting ones get a warning mark. */
export function meetingGridItems(
  meetings: readonly Meeting[],
  courses: readonly Course[],
  conflicting: ReadonlySet<string>,
  onClick?: (meeting: Meeting) => void,
): GridItem[] {
  return meetings
    .filter((mt) => mt.enabled)
    .map((mt) => {
      const course = courses.find((c) => c.id === mt.course_id)
      const label = course ? courseLabel(course) : ''
      const parts = [
        mt.section_code || null,
        mt.recurrence === 'biweekly' ? m.schedule_recurrence_biweekly() : null,
        mt.location,
      ].filter(Boolean)
      return {
        id: mt.id,
        weekday: mt.weekday,
        start: minutes(mt.start_time),
        end: minutes(mt.end_time),
        color: course ? courseColor(course) : 'var(--subject-12)',
        title: `${label} ${mt.type_code}`.trim(),
        subtitle: parts.join(' · '),
        conflict: conflicting.has(mt.id),
        onClick: onClick ? () => onClick(mt) : undefined,
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
  meetings,
  courses,
  dayStart,
  dayEnd,
  showWeekends,
  onEditMeeting,
}: {
  termId: string
  meetings: readonly Meeting[]
  courses: readonly Course[]
  dayStart: string
  dayEnd: string
  showWeekends: boolean
  onEditMeeting: (meeting: Meeting) => void
}) {
  const conflicting = useConflictingIds(termId)
  return (
    <WeekGrid
      days={weekDays(showWeekends || meetings.some((mt) => mt.enabled && mt.weekday >= 6))}
      items={meetingGridItems(meetings, courses, conflicting, onEditMeeting)}
      dayStart={minutes(dayStart)}
      dayEnd={minutes(dayEnd)}
    />
  )
}
