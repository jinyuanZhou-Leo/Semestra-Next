import type { Meeting, Section } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/** One weekly time with its section: the section holds its type, code and weeks. */
export type SectionTime = { section: Section; meeting: Meeting }

export const sectionTimes = (sections: readonly Section[]): SectionTime[] =>
  sections.flatMap((section) => section.meetings.map((meeting) => ({ section, meeting })))

/** Whether a section runs every week of the term, skipping breaks: the section dialog's default. */
export const wholeTerm = (s: Section) =>
  s.recurrence === 'weekly' && s.start_week === 1 && s.end_week == null && s.skip_breaks

/** The weeks a section runs, e.g. "Biweekly (week 2) · Weeks 1–12". */
export function weeksText(s: Section): string {
  if (wholeTerm(s)) return m.schedule_weeks_whole_term()
  const range = s.end_week
    ? m.schedule_weeks_range({ start: s.start_week, end: s.end_week })
    : m.schedule_weeks_from({ start: s.start_week })
  return s.recurrence === 'biweekly'
    ? `${m.schedule_recurrence_biweekly()} (${m.schedule_week_number({ number: s.anchor_week })}) · ${range}`
    : range
}
