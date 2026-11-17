import type { CourseOverview, NavTab } from '@semestra/api-client'
import { lmsCourseLinkGetOptions, lmsCourseOverviewOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import type { CourseInfoRowProps } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'

/** The course's tools on other sites (Piazza, Gradescope…): the external entries of its LMS menu. */
const externalTools = (overview: CourseOverview): NavTab[] =>
  overview.navigation.filter((tab) => tab.kind === 'external' && !tab.hidden && tab.web_url)

/**
 * On the course info card of a linked course: the tools the course uses on other sites, each
 * opened in a new tab. Read from the course's LMS menu, leaving out what the instructor hid; no
 * row when there are none.
 */
export function CourseLinks({ courseId, Row }: CourseInfoRowProps) {
  const linked = Boolean(
    useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link,
  )
  const tools = useQuery({
    ...lmsCourseOverviewOptions({ path: { course_id: courseId } }),
    enabled: linked,
    select: externalTools,
  }).data
  if (!linked || !tools || tools.length === 0) return null
  return (
    <Row label={m.lms_course_links_label()}>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {tools.map((tool) => (
          <li key={tool.external_id} className="min-w-0">
            <a
              href={tool.web_url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
            >
              <span className="truncate">{tool.label}</span>
              <ExternalLink aria-hidden className="size-3 shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </Row>
  )
}
