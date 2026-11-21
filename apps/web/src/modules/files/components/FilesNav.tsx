import { ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { createContext, type ReactNode, use, useState } from 'react'
import { formatHotkey, isApple, useHotkey } from '@/app/hotkeys'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Kbd } from '@/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type FilesLocation, useFilesLocation } from '../location'

type Place = { course: string | null; folder: string | null }

const keyOf = (place: Place) => `${place.course ?? ''}/${place.folder ?? ''}`

type Steps = {
  places: readonly Place[]
  index: number
  /** The step just asked for, until the address shows it. */
  going: number | null
  /** The place last seen in the address. */
  seen: string
}

type Nav = {
  canBack: boolean
  canForward: boolean
  step: (delta: -1 | 1) => void
  location: FilesLocation
}

const NavContext = createContext<Nav | null>(null)

/**
 * The places (course and folder) a files page has shown, in order, so back and forward move
 * between them and never leave the page (M07 §6.1). Opening a file does not count. Browser
 * history keeps working as it did; this is the page's own trail.
 */
export function FilesNavProvider({ children }: { children: ReactNode }) {
  const location = useFilesLocation()
  const place = { course: location.course, folder: location.folder }
  const key = keyOf(place)
  const [steps, setSteps] = useState<Steps>({ places: [place], index: 0, going: null, seen: key })
  let current = steps
  if (key !== steps.seen) {
    const arrived = steps.going !== null && keyOf(steps.places[steps.going] ?? place) === key
    current = arrived
      ? { ...steps, index: steps.going ?? steps.index, going: null, seen: key }
      : {
          places: [...steps.places.slice(0, steps.index + 1), place],
          index: steps.index + 1,
          going: null,
          seen: key,
        }
    setSteps(current)
  }
  const nav: Nav = {
    canBack: current.index > 0,
    canForward: current.index < current.places.length - 1,
    location,
    step: (delta) => {
      const target = current.index + delta
      const next = current.places[target]
      if (!next) return
      setSteps({ ...current, going: target })
      location.go({ ...next, file: null })
    },
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
 * null at the top.
 */
export function FilesNavBar({ up }: { up: (() => void) | null }) {
  const nav = use(NavContext)
  if (!nav) throw new Error('FilesNavBar must render inside FilesNavProvider')
  const { canBack, canForward, step, location } = nav
  const back = BACK()
  const forward = FORWARD()
  // A preview or the organizing dialog covers the page: the keys are its own then.
  const enabled = !location.file && !location.organize
  useHotkey(back, () => canBack && step(-1), {
    enabled,
    description: m.files_nav_back,
    order: 40,
  })
  useHotkey(forward, () => canForward && step(1), {
    enabled,
    description: m.files_nav_forward,
    order: 41,
  })
  useHotkey(UP, () => up?.(), { enabled, description: m.files_nav_up, order: 42 })
  return (
    <div className="mr-2 flex items-center gap-0.5">
      <NavButton
        label={m.files_nav_back()}
        combo={back}
        disabled={!canBack}
        onClick={() => step(-1)}
      >
        <ChevronLeft aria-hidden />
      </NavButton>
      <NavButton
        label={m.files_nav_forward()}
        combo={forward}
        disabled={!canForward}
        onClick={() => step(1)}
      >
        <ChevronRight aria-hidden />
      </NavButton>
      <NavButton label={m.files_nav_up()} combo={UP} disabled={!up} onClick={() => up?.()}>
        <ChevronUp aria-hidden />
      </NavButton>
    </div>
  )
}
