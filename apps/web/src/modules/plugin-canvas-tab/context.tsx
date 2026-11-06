import { createContext, use } from 'react'
import type { CanvasLocation } from './navigation'

/** How Canvas HTML is shown: in the app's typography, or as it looks in Canvas. */
export type CanvasDisplay = 'simplified' | 'original'

export type CanvasPage = {
  programId: string
  courseId: string
  go: (next: CanvasLocation) => void
  /** Opens the preview of a Canvas file. */
  openFile: (fileId: string) => void
  /** The account setting until the user picks another here; the pick lasts while the page is open. */
  display: CanvasDisplay
  setDisplay: (display: CanvasDisplay) => void
}

export const CanvasPageContext = createContext<CanvasPage | null>(null)

export function useCanvasPage(): CanvasPage {
  const page = use(CanvasPageContext)
  if (!page) throw new Error('Canvas views must render inside CanvasCoursePage')
  return page
}
