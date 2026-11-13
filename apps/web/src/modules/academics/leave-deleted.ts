import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { errorCode } from '@/lib/errors'
import { programPath } from './paths'
import { useCourse, useProgram, useTerms } from './queries'

const gone = (error: unknown) => error != null && errorCode(error) === 'common.not_found'

/**
 * Where to go when the Program, term or course on screen no longer exists, or `undefined` while it
 * does: up to the Program for a term or course, to `/` (the next Program) for the Program. It may
 * have been deleted here, in another tab, by Sem or over MCP, or the link is old (M02 §5.1).
 */
function useDeletedScopeExit(): string | undefined {
  const { programId, termId, courseId } = useParams({ strict: false })
  // The shell has these already; only a course page adds its course.
  const program = useProgram(programId)
  const terms = useTerms(programId ?? '')
  const course = useCourse(courseId ?? '', { enabled: courseId !== undefined })
  if (gone(program.error)) return '/'
  if (!programId) return undefined
  if (termId && terms.data && !terms.data.items.some((term) => term.id === termId)) {
    return programPath(programId)
  }
  if (gone(course.error)) return programPath(programId)
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
