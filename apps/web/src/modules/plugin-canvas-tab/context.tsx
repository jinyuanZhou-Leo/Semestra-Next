import { createContext, use } from 'react'
import type { CanvasLocation } from './navigation'

export type CanvasPage = {
  programId: string
  courseId: string
  go: (next: CanvasLocation) => void
  /** Opens the preview of a Canvas file. */
  openFile: (fileId: string) => void
}

export const CanvasPageContext = createContext<CanvasPage | null>(null)

export function useCanvasPage(): CanvasPage {
  const page = use(CanvasPageContext)
  if (!page) throw new Error('Canvas views must render inside CanvasCoursePage')
  return page
}
