import type { ItemOut } from '@semestra/api-client'
import type { JSONContent } from '@tiptap/core'
import { useQuery } from '@tanstack/react-query'
import { SquarePen, X } from 'lucide-react'
import { useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { IconAction } from '@/components/IconAction'
import { m } from '@/paraglide/messages'
import { Spinner } from '@/ui/spinner'
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
 * Sem beside a file in its preview (`files.previewPanels`, M12 §6.1): the conversation last
 * started here for this file, or a new one whose input starts with the file referenced and
 * starting points about it. Which conversation that is lives in UI state
 * (`assistant.file_session.<item_id>`, removed with the file), so it is the same after a reload
 * and on other devices; conversations elsewhere that mention the file stay where they are.
 * Source chips of this file in the answers turn the preview to their page.
 */
export default function FilePanel({
  item,
  programId,
  focusInput,
  onClose,
}: {
  item: ItemOut
  programId: string
  /** The user opened the panel just now: the caret goes to its input. */
  focusInput: boolean
  onClose: () => void
}) {
  const [stored, setStored, loaded] = useUiPref<string | null>('assistant.file_session', null, {
    scope: item.id,
  })
  const query = useQuery(sessionQueryOptions(stored))
  // A conversation deleted since (from the history) leaves a new one here.
  const sessionId = query.isError ? null : stored
  // Changes when a new conversation starts, so the conversation below starts over.
  const [view, setView] = useState(0)
  const pageScope = usePageScope({ kind: 'course', programId, courseId: item.course_id })
  const session = query.data?.session
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
            setStored(null)
            setView(view + 1)
          }}
        >
          <SquarePen />
        </IconAction>
        <IconAction label={m.assistant_file_panel_close()} onClick={onClose}>
          <X />
        </IconAction>
      </header>
      {/* Which conversation to show is known once it has been read (or found gone). */}
      {!loaded || (stored !== null && query.isPending) ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <Conversation
          key={view}
          sessionId={sessionId}
          pageScope={pageScope}
          draftKey={draftKey(item.id)}
          initialDoc={initialDoc}
          starters={starters(file)}
          onCreated={setStored}
          focusInput={focusInput}
        />
      )}
    </section>
  )
}
