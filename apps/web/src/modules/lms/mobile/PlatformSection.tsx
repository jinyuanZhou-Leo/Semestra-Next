import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { m } from '@/paraglide/messages'
import { useProviderName } from '../providers'

/** The course on its platform, last on its phone overview (M17 §4.1); nothing when unlinked. */
export default function PlatformSection({ courseId }: { programId: string; courseId: string }) {
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  const provider = useProviderName(link?.provider) ?? link?.provider
  if (!link?.web_url || !provider) return null
  return (
    <MobileSection title={provider}>
      <MobileList>
        <li>
          <a
            href={link.web_url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 items-center gap-3 px-4 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate">
              {link.external_name ?? link.external_code}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-primary">
              {m.lms_open_in({ provider })}
              <ExternalLink aria-hidden className="size-4" />
            </span>
          </a>
        </li>
      </MobileList>
    </MobileSection>
  )
}
