import type { ItemOut } from '@semestra/api-client'
import { agentSessionListOptions } from '@semestra/api-client/react-query'
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
 * Sem beside a file in its preview (`files.previewPanels`, M12 §6.1). It shows the latest
 * conversation about the file (one that referenced it, from the server), or a new one whose input
 * starts with the file referenced and starting points about it. Source chips of this file in the
 * answers turn the preview to their page.
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
  const latest = useQuery(
    agentSessionListOptions({ query: { file_id: item.id, archived: false, limit: 1 } }),
  )
  // The conversation picked here: undefined follows the latest one, null is a new one.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const sessionId = picked === undefined ? (latest.data?.items[0]?.id ?? null) : picked
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
            conversationDrafts.forget(draftKey(item.id))
            setPicked(null)
            setView(view + 1)
          }}
        >
          <SquarePen />
        </IconAction>
        <IconAction label={m.assistant_file_panel_close()} onClick={onClose}>
          <X />
        </IconAction>
      </header>
      {/* Which conversation to show is known once the list has answered (or failed). */}
      {latest.isPending && picked === undefined ? (
        <div className="flex-1" />
      ) : (
        <Conversation
          key={view}
          sessionId={sessionId}
          pageScope={pageScope}
          draftKey={draftKey(item.id)}
          initialDoc={initialDoc}
          starters={starters(file)}
          onCreated={setPicked}
          focusInput
        />
      )}
    </section>
  )
}
