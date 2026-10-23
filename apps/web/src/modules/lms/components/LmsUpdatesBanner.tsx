import {
  lmsCourseCheckUpdatesOptions,
  lmsCourseLinkGetOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { useProviderName } from '../providers'
import { reviewUpdates } from '../import/sources'

/**
 * "N imported assignments have changes or new grades on {provider}" with a button to the review (M09 §7.2). Shared
 * by the gradebook and the Canvas tab (M16); renders nothing for unlinked or paused courses.
 */
export function LmsUpdatesBanner({ programId, courseId }: { programId: string; courseId: string }) {
  const state = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data
  const link = state?.link
  const updates = useQuery({
    ...lmsCourseCheckUpdatesOptions({ path: { course_id: courseId } }),
    enabled: Boolean(link?.sync_enabled),
    retry: false,
  }).data
  const provider = useProviderName(link?.provider) ?? ''
  const [opening, setOpening] = useState(false)
  if (!link?.sync_enabled || !updates || updates.count === 0) return null

  const review = () => {
    setOpening(true)
    // Committing the review refetches everything (M08), so nothing to refetch here.
    reviewUpdates(programId, courseId)
      .catch(toastError)
      .finally(() => setOpening(false))
  }

  return (
    <Alert>
      <RefreshCw aria-hidden />
      <AlertTitle>{m.lms_updates_banner({ count: updates.count, provider })}</AlertTitle>
      <AlertDescription>
        {updates.items
          .slice(0, 3)
          .map((u) => u.name)
          .join(' · ')}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" disabled={opening} onClick={review}>
          {m.lms_updates_review()}
        </Button>
      </AlertAction>
    </Alert>
  )
}
