import { settingsValueGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { LmsDisplay } from './context'

/** The account setting that sets how LMS HTML is shown (`lms.display`, M09 §4.3). */
export const lmsSettingsOptions = () => settingsValueGetOptions({ path: { namespace: 'lms' } })

/**
 * How LMS HTML is shown on a page: the account setting until the user picks another from the
 * display menu; the pick lasts while the page stays open (every item opened on it), not saved.
 */
export function useLmsDisplay() {
  const setting = useQuery(lmsSettingsOptions()).data?.values.display
  const [picked, setDisplay] = useState<LmsDisplay | null>(null)
  const display: LmsDisplay = picked ?? (setting === 'original' ? 'original' : 'simplified')
  return { display, setDisplay }
}
