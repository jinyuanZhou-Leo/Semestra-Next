import {
  agentMemoryDeleteMutation,
  agentMemoryListOptions,
  agentMemoryUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkX } from 'lucide-react'
import { invalidateOperations } from '@/app/api'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { MEMORY_QUERIES } from '../memory'
import type { RememberedMemory } from '../stream'
import type { Step } from '../transcript'

/**
 * Under an answer that changed memories (M12 记忆): "Remembered: …" with an undo link (deletes
 * the memory) and "Updated memory: …" with one that puts back what the call replaced, for each
 * memory that is still saved (in its current wording), and "Forgot: …" for each one it deleted.
 * Memory calls run without a card, so this is where the user sees them.
 */
export function Remembered({ steps }: { steps: Step[] }) {
  const changes = steps.flatMap((step) => (step.memory ? [step.memory] : []))
  const saved = changes.filter((change) => change.action !== 'forgot')
  const memories = useQuery({ ...agentMemoryListOptions(), enabled: saved.length > 0 })
  const queryClient = useQueryClient()
  const refresh = () => invalidateOperations(queryClient, MEMORY_QUERIES)
  const remove = useMutation({
    ...agentMemoryDeleteMutation(),
    onError: toastError,
    onSettled: refresh,
  })
  const restore = useMutation({
    ...agentMemoryUpdateMutation(),
    onError: toastError,
    onSettled: refresh,
  })
  const current = new Map(memories.data?.items.map((memory) => [memory.id, memory]) ?? [])
  const shown = changes.flatMap((change): { change: RememberedMemory; text: string }[] => {
    if (change.action === 'forgot') {
      return [{ change, text: change.description ?? change.content ?? '' }]
    }
    const row = current.get(change.id)
    return row ? [{ change, text: row.description }] : []
  })
  if (shown.length === 0) return null
  const undo = (change: RememberedMemory) => {
    if (change.action === 'updated' && change.previous) {
      restore.mutate({ path: { id: change.id }, body: change.previous })
    } else {
      remove.mutate({ path: { id: change.id } })
    }
  }
  return (
    <ul className="space-y-1">
      {shown.map(({ change, text }) => (
        <li
          key={`${change.action ?? 'remembered'}-${change.id}`}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          {change.action === 'forgot' ? (
            <>
              <BookmarkX aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{m.assistant_memory_forgot({ content: text })}</span>
            </>
          ) : (
            <>
              <Bookmark aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {change.action === 'updated'
                  ? m.assistant_memory_updated({ content: text })
                  : m.assistant_memory_remembered({ content: text })}
              </span>
              <span aria-hidden>·</span>
              <Button
                variant="link"
                size="xs"
                className="h-auto shrink-0 p-0 text-xs"
                disabled={remove.isPending || restore.isPending}
                onClick={() => undo(change)}
              >
                {m.assistant_memory_undo()}
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
