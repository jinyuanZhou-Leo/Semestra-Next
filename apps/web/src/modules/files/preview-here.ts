import { createContext, use } from 'react'

/**
 * The file the preview around this shows, and how to go to a page of it: a source chip
 * (`Citation`) of that file inside the preview (e.g. in Sem's answer beside it) turns its page
 * instead of opening a second preview.
 */
export type PreviewHere = {
  itemId: string
  open: (page: number, terms?: readonly string[]) => void
}

export const PreviewHereContext = createContext<PreviewHere | null>(null)

export const usePreviewHere = () => use(PreviewHereContext)
