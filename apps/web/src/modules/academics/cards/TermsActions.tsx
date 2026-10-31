import { CalendarPlus } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { HistoryLink } from '@/components/HistoryLink'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { newTermPath } from '../paths'

/** "New term" in the Terms card's header, so the card body is all timeline. */
export default function TermsActions({ scope }: CardProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.academics_term_new()}
            className="text-muted-foreground"
            nativeButton={false}
            render={<HistoryLink href={newTermPath(scope.programId)} />}
          />
        }
      >
        <CalendarPlus aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{m.academics_term_new()}</TooltipContent>
    </Tooltip>
  )
}
