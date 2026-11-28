import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'

function withoutTask(prev: Record<string, string | undefined>) {
  const { task: _task, ...rest } = prev
  return rest
}

/**
 * The task a link points at (`?task=<id>`, e.g. a command palette result). The parameter leaves
 * the URL at once, so a reload or going back does not open it again; the page keeps it open.
 */
export function useLinkedTask(): string | null {
  const search = useSearch({ strict: false }) as { task?: unknown }
  const navigate = useNavigate()
  const id = typeof search.task === 'string' && search.task ? search.task : null
  useEffect(() => {
    if (id) void navigate({ to: '.', search: withoutTask, replace: true })
  }, [id, navigate])
  return id
}
