import { useEffect, useState } from 'react'
import { assistantPage } from './store'

/**
 * Which conversation the full page (computer or phone) shows, from the URL's `sessionId`, and the
 * React key of its component. Only a change of conversation changes the key: a new conversation
 * keeps its component (and the answer being written) when it gets its URL, and other changes of
 * the address (the settings dialog, `?…`) keep it too. The page's conversation is recorded, so its
 * entries go back to it after another page (M12 §6.1).
 */
export function usePageConversation(sessionId: string | null) {
  // The last conversation the URL named: a new conversation after it needs a new component.
  const [named, setNamed] = useState(sessionId)
  if (sessionId !== null && sessionId !== named) setNamed(sessionId)
  const [created, setCreated] = useState({ id: null as string | null, key: '' })
  const newKey = `new-${named ?? ''}`
  const key = sessionId === null ? newKey : sessionId === created.id ? created.key : sessionId
  // The conversation shown, also before its URL has its id.
  const currentId = sessionId ?? (created.key === key ? created.id : null)

  useEffect(() => {
    assistantPage.show(currentId)
  }, [currentId])
  useEffect(() => {
    assistantPage.setOpen(true)
    return () => assistantPage.setOpen(false)
  }, [])

  return {
    key,
    currentId,
    /** The new conversation shown got its id (its URL follows). */
    created: (id: string) => setCreated({ id, key }),
  }
}
