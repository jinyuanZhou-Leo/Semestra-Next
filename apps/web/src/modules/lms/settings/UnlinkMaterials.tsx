import type { MaterialCounts } from '@semestra/api-client'
import { Cloud, HardDrive } from 'lucide-react'
import { m } from '@/paraglide/messages'

/** What unlinking a course does to its materials, in numbers (in its confirmation). */
export function UnlinkMaterials({
  counts,
  provider,
}: {
  counts: MaterialCounts
  provider: string
}) {
  if (counts.local + counts.online === 0) return null
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {counts.local > 0 ? (
        <li className="flex items-start gap-2.5">
          <HardDrive aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{m.lms_course_unlink_kept({ count: counts.local })}</span>
        </li>
      ) : null}
      {counts.online > 0 ? (
        <li className="flex items-start gap-2.5">
          <Cloud aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{m.lms_course_unlink_removed({ count: counts.online, provider })}</span>
        </li>
      ) : null}
    </ul>
  )
}
