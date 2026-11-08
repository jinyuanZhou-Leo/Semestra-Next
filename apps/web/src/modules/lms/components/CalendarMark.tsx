import type { Occurrence } from '@semestra/api-client'
import { lmsProgramBindingGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { School } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { useProviderName, useProviderUis } from '../providers'

function useProvider(programId: string) {
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } })).data
  const kind = binding?.connection?.provider
  return {
    name: useProviderName(kind) ?? m.lms_calendar_source(),
    ui: useProviderUis().get(kind ?? ''),
  }
}

/** The platform's logo on a calendar event read from it (`calendarSources` `Mark`, M04). */
export function CalendarMark({ programId }: { programId: string }) {
  const { name, ui } = useProvider(programId)
  const Logo = ui?.logo ?? School
  return (
    <span className="inline-flex shrink-0">
      <Logo aria-hidden className="size-3" />
      <span className="sr-only">{name}</span>
    </span>
  )
}

/** "Open in Canvas" in a platform event's details (`calendarSources` `OpenLabel`). */
export function CalendarOpenLabel({ programId }: { programId: string; occurrence: Occurrence }) {
  return m.lms_open_in({ provider: useProvider(programId).name })
}
