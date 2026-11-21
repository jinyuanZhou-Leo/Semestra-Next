import { ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { createContext, type ReactNode, use, useState } from 'react'
import { formatHotkey, isApple, useHotkey } from '@/app/hotkeys'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Kbd } from '@/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type FilesLocation, useFilesLocation } from '../location'

type Entry = { key: string; place: string; preview: boolean }

type Trail = {
  /** What the files page showed at each history position it has been at. */
  entries: Readonly<Record<number, Entry>>
  last: number
}

type Nav = {
  /** How many history steps back/forward lands on the previous/next place, or null. */
  back: number | null
  forward: number | null
  go: (steps: number) => void
  location: FilesLocation
}

const NavContext = createContext<Nav | null>(null)

/** The nearest position from `from` in `direction` that is a place, past previewed files. */
function neighbour(entries: Trail['entries'], from: number, direction: 1 | -1): number | null {
  for (let at = from + direction, steps = direction; ; at += direction, steps += direction) {
    const entry = entries[at]
    if (!entry) return null
    if (!entry.preview) return steps
  }
}

/**
 * Back and forward are the browser's own history, limited to the files page (M07 §6.1): each
 * history position is remembered with the place (course and folder) the page showed there, so
 * the buttons step to the nearest one before or after, past previewed files, and are off when
 * the next step would leave the page. There is one history: the browser's back key and the
 * button go to the same place.
 */
export function FilesNavProvider({ children }: { children: ReactNode }) {
  const location = useFilesLocation()
  const router = useRouter()
  const state = useRouterState({ select: (s) => s.location.state }) as {
    __TSR_index?: number
    __TSR_key?: string
  }
  const index = state.__TSR_index ?? 0
  const entry: Entry = {
    key: state.__TSR_key ?? '',
    place: `${location.course ?? ''}/${location.folder ?? ''}`,
    preview: location.file !== null,
  }
  const [trail, setTrail] = useState<Trail>({ entries: {}, last: index })
  let current = trail
  const known = trail.entries[index]
  if (
    !known ||
    known.key !== entry.key ||
    known.place !== entry.place ||
    known.preview !== entry.preview
  ) {
    // A new position after going back drops what lay ahead; changing the one we are at (a
    // correction, closing a preview) keeps it.
    const pushedOver = known !== undefined && known.key !== entry.key && index !== trail.last
    const kept = Object.entries(trail.entries).filter(([at]) => !pushedOver || Number(at) <= index)
    current = {
      entries: { ...Object.fromEntries(kept), [index]: entry },
      last: index,
    }
    setTrail(current)
  } else if (trail.last !== index) {
    current = { ...trail, last: index }
    setTrail(current)
  }
  const nav: Nav = {
    back: neighbour(current.entries, index, -1),
    forward: neighbour(current.entries, index, 1),
    go: (steps) => router.history.go(steps),
    location,
  }
  return <NavContext value={nav}>{children}</NavContext>
}

const BACK = () => (isApple() ? 'mod+bracketleft' : 'alt+left')
const FORWARD = () => (isApple() ? 'mod+bracketright' : 'alt+right')
const UP = 'alt+up'

function NavButton({
  label,
  combo,
  disabled,
  onClick,
  children,
}: {
  label: string
  combo: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            // Focusable while disabled, so the label stays reachable from the keyboard.
            disabled={disabled}
            focusableWhenDisabled
            className="aria-disabled:opacity-50"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label} <Kbd>{formatHotkey(combo)}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Back, forward and up-one-level buttons with their shortcuts. `up` goes up a level, or is
 * null at the top. `onNavigate` runs before any of them (the page clears its search so the
 * new place is what shows).
 */
export function FilesNavBar({
  up,
  onNavigate,
}: {
  up: (() => void) | null
  onNavigate: () => void
}) {
  const nav = use(NavContext)
  if (!nav) throw new Error('FilesNavBar must render inside FilesNavProvider')
  const { location, go } = nav
  const back = BACK()
  const forward = FORWARD()
  const goBack = nav.back === null ? null : () => (onNavigate(), go(nav.back ?? 0))
  const goForward = nav.forward === null ? null : () => (onNavigate(), go(nav.forward ?? 0))
  const goUp = up ? () => (onNavigate(), up()) : null
  // A preview or the organizing dialog covers the page: the keys are its own then. A key that
  // has nowhere to go is left to the browser.
  const covered = location.file !== null || location.organize
  useHotkey(back, () => goBack?.(), {
    ignoreEventWhen: () => covered || !goBack,
    description: m.files_nav_back,
    order: 40,
  })
  useHotkey(forward, () => goForward?.(), {
    ignoreEventWhen: () => covered || !goForward,
    description: m.files_nav_forward,
    order: 41,
  })
  useHotkey(UP, () => goUp?.(), {
    ignoreEventWhen: () => covered || !goUp,
    description: m.files_nav_up,
    order: 42,
  })
  return (
    <div className="mr-2 flex items-center gap-0.5">
      <NavButton
        label={m.files_nav_back()}
        combo={back}
        disabled={!goBack}
        onClick={() => goBack?.()}
      >
        <ChevronLeft aria-hidden />
      </NavButton>
      <NavButton
        label={m.files_nav_forward()}
        combo={forward}
        disabled={!goForward}
        onClick={() => goForward?.()}
      >
        <ChevronRight aria-hidden />
      </NavButton>
      <NavButton label={m.files_nav_up()} combo={UP} disabled={!goUp} onClick={() => goUp?.()}>
        <ChevronUp aria-hidden />
      </NavButton>
    </div>
  )
}
