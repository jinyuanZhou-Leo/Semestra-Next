import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import type { CourseInfoRowProps } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { externalLabel } from '../external'
import { useProviderUis } from '../providers'

/** On the course info card of a linked course: the platform, its course and a link to it. */
export function CourseInfoLms({ courseId, Row }: CourseInfoRowProps) {
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  const ui = useProviderUis().get(link?.provider ?? '')
  if (!link) return null
  const provider = ui?.label() ?? link.provider
  return (
    <Row label={m.lms_course_info_label()}>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{provider}</Badge>
        <span className="truncate">
          {externalLabel({ code: link.external_code, name: link.external_name ?? '' })}
        </span>
        {link.web_url ? (
          <a
            href={link.web_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {m.lms_open_in({ provider })}
            <ExternalLink aria-hidden className="size-3 shrink-0" />
          </a>
        ) : null}
      </span>
    </Row>
  )
}
