import { academicsTermGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { errorCode } from '@/lib/errors'
import { programPath } from './paths'
import { useCourse, useProgram } from './queries'

const gone = (error: unknown) => error != null && errorCode(error) === 'common.not_found'

/**
 * Where to go when the Program, term or course on screen no longer exists, or `undefined` while it
 * does: up to the Program for a term or course, to `/` (the next Program) for the Program. It may
 * have been deleted here, in another tab, by Sem or over MCP, or the link is old (M02 §5.1).
 */
function useDeletedScopeExit(): string | undefined {
  const { programId, termId, courseId } = useParams({ strict: false })
  // Each is asked for by itself: a list that lacks it may only be behind (a term Sem just created,
  // whose link is followed before the list was read again). The shell has the Program already.
  const program = useProgram(programId)
  const term = useQuery({
    ...academicsTermGetOptions({ path: { term_id: termId ?? '' } }),
    enabled: termId !== undefined,
  })
  const course = useCourse(courseId ?? '', { enabled: courseId !== undefined })
  if (gone(program.error)) return '/'
  if (!programId) return undefined
  // A term of another Program (an edited link) is not on this Program's pages either.
  const elsewhere = term.data !== undefined && term.data.program_id !== programId
  if (gone(term.error) || elsewhere || gone(course.error)) return programPath(programId)
  return undefined
}

/** Leaves a page whose Program, term or course was deleted, for the nearest one that exists. */
export function useLeaveDeletedScope() {
  const exit = useDeletedScopeExit()
  const navigate = useNavigate()
  useEffect(() => {
    if (exit) void navigate({ href: exit, replace: true })
  }, [exit, navigate])
}
