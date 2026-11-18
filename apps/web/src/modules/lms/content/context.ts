import { createContext, use } from 'react'
import type { InternalLink } from '@/components/SafeHtml'

/** How LMS HTML is shown: in the app's typography, or as it looks on the platform. */
export type LmsDisplay = 'simplified' | 'original'

/**
 * What LMS content (an announcement, a page in the Canvas tab) is shown for: its course, its
 * platform, the display picked while it is open, and where its platform links go.
 */
export type LmsContent = {
  courseId: string
  /** The platform's name, for "Open in …" and the display's name. */
  provider: string
  display: LmsDisplay
  setDisplay: (display: LmsDisplay) => void
  /** Takes over a platform link of the HTML; false leaves it a link that opens in a new tab. */
  openLink: (link: InternalLink) => boolean
}

export const LmsContentContext = createContext<LmsContent | null>(null)

export function useLmsContent(): LmsContent {
  const content = use(LmsContentContext)
  if (!content) throw new Error('LMS content must render inside LmsContentContext')
  return content
}
