import { useEffect, useState } from 'react'
import type { Message } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

/** UI state: false while the tour is due (set at the end of onboarding), true once seen. */
export const TOUR_DONE_KEY = 'onboarding.tour_done'

type Step = { target: string; title: Message; body: Message }

/**
 * The five places the tour points at (M02 §5.7). Steps whose element is not on the page are
 * skipped (the term switcher needs a term), so the command palette (M10) and assistant (M12)
 * steps appear once those exist.
 */
const STEPS: readonly Step[] = [
  { target: 'sidebar', title: m.academics_tour_sidebar_title, body: m.academics_tour_sidebar_body },
  { target: 'term', title: m.academics_tour_term_title, body: m.academics_tour_term_body },
  { target: 'cards', title: m.academics_tour_cards_title, body: m.academics_tour_cards_body },
  {
    target: 'command-palette',
    title: m.academics_tour_command_title,
    body: m.academics_tour_command_body,
  },
  {
    target: 'assistant',
    title: m.academics_tour_assistant_title,
    body: m.academics_tour_assistant_body,
  },
]

/** Targets M02's own pages always render; the others belong to modules that may be absent. */
const PAGE_TARGETS = ['sidebar', 'cards']
const TARGET_WAIT_MS = 10_000

function findTarget(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
}

type Box = { top: number; left: number; width: number; height: number }

function useTargetBox(target: string | undefined): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    if (!target) return
    let frame = 0
    const measure = () => {
      const rect = findTarget(target)?.getBoundingClientRect()
      setBox(
        rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
      )
    }
    frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
    }
  }, [target])
  return box
}

function TourStep({
  steps,
  index,
  onNext,
  onDone,
}: {
  steps: readonly Step[]
  index: number
  onNext: () => void
  onDone: () => void
}) {
  const step = steps[index]
  const box = useTargetBox(step?.target)
  if (!step || !box) return null
  const last = index === steps.length - 1
  const below = box.top + box.height + 180 < window.innerHeight
  const cardTop = below ? box.top + box.height + 12 : Math.max(12, box.top)
  const cardLeft = below
    ? Math.min(box.left, window.innerWidth - 336)
    : Math.min(box.left + box.width + 12, window.innerWidth - 336)
  return (
    <dialog
      open
      aria-labelledby="tour-title"
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0"
    >
      <div
        aria-hidden
        className="pointer-events-none fixed rounded-2xl ring-2 ring-primary transition-all motion-reduce:transition-none"
        style={{
          top: box.top - 4,
          left: box.left - 4,
          width: box.width + 8,
          height: box.height + 8,
          boxShadow: '0 0 0 9999px color-mix(in oklab, var(--foreground) 35%, transparent)',
        }}
      />
      <div
        className="fixed w-80 space-y-2 rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        style={{ top: cardTop, left: Math.max(12, cardLeft) }}
      >
        <p className="text-xs text-muted-foreground">
          {m.academics_tour_progress({ current: index + 1, total: steps.length })}
        </p>
        <h2 id="tour-title" className="font-heading text-base font-medium">
          {step.title()}
        </h2>
        <p className="text-muted-foreground">{step.body()}</p>
        <div className="flex justify-end gap-2 pt-1">
          {last ? null : (
            <Button variant="ghost" size="sm" onClick={onDone}>
              {m.academics_tour_skip()}
            </Button>
          )}
          <Button size="sm" onClick={last ? onDone : onNext}>
            {last ? m.academics_tour_done() : m.academics_tour_next()}
          </Button>
        </div>
      </div>
    </dialog>
  )
}

/** The first-run tour (M02 §5.7). Shows while `onboarding.tour_done` is false. */
export function Tour() {
  const [done, setDone] = useUiPref<boolean | null>(TOUR_DONE_KEY, null)
  const [index, setIndex] = useState(0)
  const [steps, setSteps] = useState<readonly Step[] | null>(null)
  useEffect(() => {
    if (done !== false) return
    // Wait for the page under the tour (lazy pages and cards) to render its targets: poll until
    // every step of this module's own page is there, or give up after a while and show the rest.
    const started = Date.now()
    const timer = setInterval(() => {
      const ready = PAGE_TARGETS.every(findTarget)
      if (!ready && Date.now() - started < TARGET_WAIT_MS) return
      clearInterval(timer)
      setSteps(STEPS.filter((step) => findTarget(step.target)))
    }, 200)
    return () => clearInterval(timer)
  }, [done])
  if (done !== false || !steps || steps.length === 0) return null
  return (
    <TourStep
      steps={steps}
      index={index}
      onNext={() => setIndex((i) => i + 1)}
      onDone={() => setDone(true)}
    />
  )
}
