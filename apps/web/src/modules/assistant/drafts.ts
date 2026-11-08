import type { AgentScope } from '@semestra/api-client'
import type { JSONContent } from '@tiptap/core'
import type { PendingAttachment } from './components/Composer'

/**
 * The key of a Program's conversation not created yet (the panel and the page share it). Per
 * Program, since its scope and `@` references name that Program's terms and courses.
 */
export function newConversationKey(programId: string | null | undefined): string {
  return `new:${programId ?? ''}`
}

/**
 * What the user has prepared in a conversation but not sent (M12 §6.1): the input's text, the
 * attached files and, while the conversation is new, where it works and whether it is temporary.
 * It belongs to the conversation, not to the component showing it, so closing the panel, opening
 * settings, going to another page or moving between the panel and the page keeps it.
 */
export type Draft = {
  doc?: JSONContent | null
  attachments?: readonly PendingAttachment[]
  scope?: AgentScope | null
  temporary?: boolean
}

const drafts = new Map<string, Draft>()

export const conversationDrafts = {
  get: (key: string): Draft => drafts.get(key) ?? {},
  update(key: string, patch: Draft) {
    drafts.set(key, { ...drafts.get(key), ...patch })
  },
  /** The new conversation (`from`) was created: what was prepared in it now belongs to `id`. */
  created(from: string, id: string) {
    const draft = drafts.get(from)
    drafts.delete(from)
    if (draft) drafts.set(id, { ...drafts.get(id), ...draft })
  },
  forget(key: string) {
    drafts.delete(key)
  },
  /** Tests start without drafts. */
  reset() {
    drafts.clear()
  },
}
