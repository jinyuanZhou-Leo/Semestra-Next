import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import type { CourseInfoRowProps } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { externalLabel } from '../external'
import { useProviderName } from '../providers'

/** On the course info card of a linked course: one line with the platform and its course, linked. */
export function CourseInfoLms({ courseId, Row }: CourseInfoRowProps) {
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  const providerName = useProviderName(link?.provider)
  if (!link) return null
  const provider = providerName ?? link.provider
  const label = externalLabel({ code: link.external_code, name: link.external_name ?? '' })
  return (
    <Row label={m.lms_course_info_label()}>
      <span className="flex min-w-0 items-center gap-1.5">
        <Badge variant="secondary" className="shrink-0">
          {provider}
        </Badge>
        {link.web_url ? (
          <a
            href={link.web_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
          >
            <span className="truncate">{label}</span>
            <ExternalLink aria-hidden className="size-3 shrink-0" />
          </a>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
    </Row>
  )
}
