import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import { createContext, useContext } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** What a section shows next to its title; forms inside the section report through it. */
export type SectionStatus = { status: SaveStatus; retry?: () => void }

export const SectionStatusContext = createContext<(status: SectionStatus) => void>(() => {})

export function useReportSectionStatus() {
  return useContext(SectionStatusContext)
}

/** "Saving… / Saved / Couldn't save (Retry)" beside a section title (M11 §5.1). */
export function SaveIndicator({ status, retry }: SectionStatus) {
  return (
    <output className="block min-h-6 text-xs text-muted-foreground">
      {status === 'saving' ? (
        <span className="flex items-center gap-1.5">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          {m.settings_status_saving()}
        </span>
      ) : null}
      {status === 'saved' ? (
        <span className="flex items-center gap-1.5">
          <Check aria-hidden className="size-3.5" />
          {m.settings_status_saved()}
        </span>
      ) : null}
      {status === 'error' ? (
        <span className="flex items-center gap-1.5 text-destructive">
          <CircleAlert aria-hidden className="size-3.5" />
          {m.settings_status_error()}
          {retry ? (
            <Button variant="link" size="xs" className="h-auto px-1" onClick={retry}>
              {m.common_retry()}
            </Button>
          ) : null}
        </span>
      ) : null}
    </output>
  )
}
