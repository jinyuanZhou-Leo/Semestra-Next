import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'

const HIGHLIGHT_MS = 2400

function withoutAssessment(prev: Record<string, string | undefined>) {
  const { assessment: _assessment, ...rest } = prev
  return rest
}

/**
 * The assessment a link points at (`?assessment=<id>`, e.g. "Open" on a calendar deadline): its
 * row is scrolled into view and marked for a moment, then the parameter leaves the URL so a
 * reload does not repeat it.
 */
export function useHighlightedAssessment(): string | null {
  const search = useSearch({ strict: false }) as { assessment?: unknown }
  const navigate = useNavigate()
  const id = typeof search.assessment === 'string' && search.assessment ? search.assessment : null
  useEffect(() => {
    if (!id) return
    const row = [...document.querySelectorAll<HTMLElement>('[data-assessment]')].find(
      (el) => el.dataset.assessment === id,
    )
    row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    const timer = setTimeout(
      () => void navigate({ to: '.', search: withoutAssessment, replace: true }),
      HIGHLIGHT_MS,
    )
    return () => clearTimeout(timer)
  }, [id, navigate])
  return id
}
