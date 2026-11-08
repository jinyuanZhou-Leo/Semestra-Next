import { useEffect, useState } from 'react'
import type { Message } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/ui/popover'

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
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = findTarget(target)?.getBoundingClientRect()
        setBox(
          rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
        )
      })
    }
    measure()
    // Scrolling any container moves the target too.
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
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
  // The highlight ring is the popover's anchor, so the card follows it and stays on screen; Esc
  // skips the tour, a click elsewhere does not (the dimmed page is only there to look at).
  return (
    <Popover
      open
      modal
      onOpenChange={(open, details) => {
        if (!open && details.reason !== 'outside-press') onDone()
      }}
    >
      <PopoverTrigger
        nativeButton={false}
        render={
          <div
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed z-50 rounded-2xl ring-2 ring-primary transition-all motion-reduce:transition-none"
            style={{
              top: box.top - 4,
              left: box.left - 4,
              width: box.width + 8,
              height: box.height + 8,
              boxShadow: '0 0 0 9999px color-mix(in oklab, var(--foreground) 35%, transparent)',
            }}
          />
        }
      />
      <PopoverContent side="bottom" align="start" sideOffset={12} className="w-80 gap-2">
        <p className="text-xs text-muted-foreground">
          {m.academics_tour_progress({ current: index + 1, total: steps.length })}
        </p>
        <PopoverHeader>
          <PopoverTitle className="font-heading">{step.title()}</PopoverTitle>
          <PopoverDescription>{step.body()}</PopoverDescription>
        </PopoverHeader>
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
      </PopoverContent>
    </Popover>
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
