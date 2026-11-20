import { useQueries } from '@tanstack/react-query'
import { useExtensions } from '@/app/registry'
import { TASK_LINKS, type TaskLink } from './types'

/** Starts what the tasks' links read (`TaskLink.query`), for a page that lists a Program's tasks. */
export function useTaskLinkQueries(programId: string) {
  const links = useExtensions<TaskLink>(TASK_LINKS)
  useQueries({ queries: links.map((link) => link.query({ programId })) })
}
