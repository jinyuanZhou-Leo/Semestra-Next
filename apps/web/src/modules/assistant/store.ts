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
}

const INITIAL: PanelState = { open: false, sessionId: null, question: null, view: 0 }
let state: PanelState = INITIAL
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
        view: state.view + 1,
      })
    } else {
      set({ open: true })
    }
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
  /** Tests start from a closed panel. */
  reset() {
    state = INITIAL
  },
}

export function usePanel(): PanelState {
  return useSyncExternalStore(panel.subscribe, panel.get, panel.get)
}
