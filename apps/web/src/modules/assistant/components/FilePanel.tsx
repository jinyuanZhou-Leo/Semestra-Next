import type { ItemOut } from '@semestra/api-client'
import type { JSONContent } from '@tiptap/core'
import { useQuery } from '@tanstack/react-query'
import { SquarePen, X } from 'lucide-react'
import { useState } from 'react'
import { IconAction } from '@/components/IconAction'
import { m } from '@/paraglide/messages'
import { conversationDrafts } from '../drafts'
import { chipNode, type MessageReference } from '../prompt'
import { usePageScope } from '../scope'
import { sessionQueryOptions } from '../use-chat'
import { Conversation } from './Conversation'
import { sessionTitle } from './SessionList'
import type { PromptStarter } from './SuggestionChips'

/**
 * The conversation each file was last asked about, so reopening the file picks it up again.
 * Like drafts (`drafts.ts`), it lasts while the app is open; the conversation itself is in the
 * history like any other.
 */
const fileSessions = new Map<string, string>()

const draftKey = (itemId: string) => `file:${itemId}`

function starters(file: MessageReference): PromptStarter[] {
  const at = `@${file.label}`
  return [
    {
      key: 'summary',
      label: m.assistant_file_starter_summary(),
      text: m.assistant_file_starter_summary_prompt({ file: at }),
      references: [file],
    },
    {
      key: 'concepts',
      label: m.assistant_file_starter_concepts(),
      text: m.assistant_file_starter_concepts_prompt({ file: at }),
      references: [file],
    },
    {
      key: 'practice',
      label: m.assistant_file_starter_practice(),
      text: m.assistant_file_starter_practice_prompt({ file: at }),
      references: [file],
    },
  ]
}

/**
 * Sem beside a file in its preview (`files.previewPanels`, M12 §6.1): a conversation whose input
 * starts with the file referenced, and starting points about it. Source chips of this file in
 * the answers turn the preview to their page.
 */
export default function FilePanel({
  item,
  programId,
  onClose,
}: {
  item: ItemOut
  programId: string
  onClose: () => void
}) {
  const [sessionId, setSessionId] = useState(() => fileSessions.get(item.id) ?? null)
  // Changes when a new conversation starts, so the conversation below starts over.
  const [view, setView] = useState(0)
  const pageScope = usePageScope({ kind: 'course', programId, courseId: item.course_id })
  const session = useQuery(sessionQueryOptions(sessionId)).data?.session
  const file: MessageReference = { kind: 'file', id: item.id, label: item.display_name }
  const initialDoc: JSONContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [chipNode(file), { type: 'text', text: ' ' }] }],
  }

  return (
    <section aria-label={m.assistant_name()} className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-0.5 border-b px-2">
        <h2 className="min-w-0 flex-1 truncate px-1.5 text-sm font-medium">
          {session ? sessionTitle(session) : m.assistant_name()}
        </h2>
        <IconAction
          label={m.assistant_new()}
          onClick={() => {
            fileSessions.delete(item.id)
            conversationDrafts.forget(draftKey(item.id))
            setSessionId(null)
            setView(view + 1)
          }}
        >
          <SquarePen />
        </IconAction>
        <IconAction label={m.common_close()} onClick={onClose}>
          <X />
        </IconAction>
      </header>
      <Conversation
        key={view}
        sessionId={sessionId}
        pageScope={pageScope}
        draftKey={draftKey(item.id)}
        initialDoc={initialDoc}
        starters={starters(file)}
        onCreated={(id) => {
          fileSessions.set(item.id, id)
          setSessionId(id)
        }}
        focusInput
      />
    </section>
  )
}
