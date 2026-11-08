import { useSyncExternalStore } from 'react'
import { conversationDrafts } from './drafts'

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
}

const INITIAL: PanelState = {
  open: false,
  sessionId: null,
  question: null,
  view: 0,
}
let state: PanelState = INITIAL
// The conversation the full page shows, or showed last: its entries in the sidebar and tab bar go
// back to it, and `open` hands it to the panel. Null for a new conversation.
let pageSession: string | null = null
let pageOpen = false
// The last page outside the assistant, where the hand-over goes back to.
let returnTo: string | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function set(next: Partial<PanelState>) {
  state = { ...state, ...next }
  notify()
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
        view: state.view + 1,
      })
    } else {
      set({ open: true })
    }
  },
  /**
   * Shows the full page's conversation in the panel; what was prepared in it comes along, since
   * drafts belong to the conversation (`drafts.ts`).
   */
  moveHere(sessionId: string | null) {
    set({ open: true, sessionId, question: null, view: state.view + 1 })
  },
  returnTo: () => returnTo,
  setReturnTo(href: string) {
    returnTo = href
  },
  close() {
    set({ open: false })
  },
  show(sessionId: string | null) {
    set({ sessionId, question: null, view: state.view + 1 })
  },
  /** A new conversation was created by its first message. */
  created(sessionId: string) {
    set({ sessionId })
  },
  takeQuestion() {
    const question = state.question
    if (question) set({ question: null })
    return question
  },
  /** A conversation was deleted: nothing goes back to it, and its draft is dropped. */
  forget(sessionId: string) {
    conversationDrafts.forget(sessionId)
    if (pageSession === sessionId) assistantPage.show(null)
    if (state.sessionId === sessionId) panel.show(null)
  },
  /** Tests start from a closed panel and no drafts. */
  reset() {
    state = INITIAL
    pageSession = null
    pageOpen = false
    returnTo = null
    conversationDrafts.reset()
  },
}

/** The full page (`/p/$programId/assistant/$sessionId?`), as far as the rest of the app needs it. */
export const assistantPage = {
  subscribe: panel.subscribe,
  isOpen: () => pageOpen,
  sessionId: () => pageSession,
  setOpen(open: boolean) {
    pageOpen = open
  },
  show(sessionId: string | null) {
    if (pageSession === sessionId) return
    pageSession = sessionId
    notify()
  },
}

export function usePanel(): PanelState {
  return useSyncExternalStore(panel.subscribe, panel.get, panel.get)
}
