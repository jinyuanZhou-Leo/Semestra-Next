import type { JSONContent } from '@tiptap/core'
import { useSyncExternalStore } from 'react'

/**
 * Whether the side panel is open and which conversation it shows. Shared by the panel, the
 * sidebar entry, `Cmd/Ctrl + J` and the palette's "Ask AI" (a question starts a new
 * conversation with it).
 */
export type PanelState = {
  open: boolean
  sessionId: string | null
  /** A question to send as soon as the panel shows a new conversation. */
  question: { text: string; key: number } | null
  /** Changes when another conversation is shown (not when a new one gets its id). */
  view: number
  /** Whether a new conversation in the panel starts as a temporary chat. */
  temporary: boolean
  /** What was written on the full page, which the panel's input starts with. */
  draft: JSONContent | null
}

const INITIAL: PanelState = {
  open: false,
  sessionId: null,
  question: null,
  view: 0,
  temporary: false,
  draft: null,
}
let state: PanelState = INITIAL
// What the full page shows, so `open` can hand it to the panel; null while the page is closed.
let page: { sessionId: string | null; temporary: boolean } | null = null
// The last page outside the assistant, where the hand-over goes back to.
let returnTo: string | null = null
let pageDraft: JSONContent | null = null
const listeners = new Set<() => void>()

function set(next: Partial<PanelState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const panel = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  toggle() {
    set({ open: !state.open })
  },
  open(question?: string) {
    if (question?.trim()) {
      set({
        open: true,
        sessionId: null,
        question: { text: question.trim(), key: Date.now() },
        temporary: false,
        draft: null,
        view: state.view + 1,
      })
    } else {
      set({ open: true })
    }
  },
  /** Shows an open conversation in the panel (the full page hands its conversation over). */
  moveHere(sessionId: string | null, temporary: boolean, draft: JSONContent | null) {
    set({ open: true, sessionId, temporary, draft, question: null, view: state.view + 1 })
  },
  page: () => page,
  setPage(next: typeof page) {
    page = next
  },
  pageDraft: () => pageDraft,
  setPageDraft(doc: JSONContent | null) {
    pageDraft = doc
  },
  returnTo: () => returnTo,
  setReturnTo(href: string) {
    returnTo = href
  },
  close() {
    set({ open: false })
  },
  show(sessionId: string | null) {
    set({ sessionId, temporary: false, draft: null, question: null, view: state.view + 1 })
  },
  /** A new conversation was created by its first message. */
  created(sessionId: string) {
    set({ sessionId })
  },
  /** The panel's input took the carried-over text; it is not offered again on a reopen. */
  takeDraft() {
    if (state.draft) set({ draft: null })
  },
  takeQuestion() {
    const question = state.question
    if (question) set({ question: null })
    return question
  },
  /** Tests start from a closed panel. */
  reset() {
    state = INITIAL
    page = null
    pageDraft = null
    returnTo = null
  },
}

export function usePanel(): PanelState {
  return useSyncExternalStore(panel.subscribe, panel.get, panel.get)
}
