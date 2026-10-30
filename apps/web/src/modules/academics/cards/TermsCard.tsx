import { CalendarPlus, CalendarRange } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { HistoryLink } from '@/components/HistoryLink'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { newTermPath, termPath } from '../paths'
import { useTerms } from '../queries'

const day = (iso: string) => formatDate(`${iso}T00:00`)

/** The Program's terms as a timeline, newest first, the current one highlighted (M02 §5.2). */
export default function TermsCard({ scope }: CardProps) {
  const programId = scope.programId
  const terms = useTerms(programId).data?.items
  if (!terms) return <CardSkeleton />
  return (
    <div className="flex h-full flex-col gap-2">
      <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {terms.length === 0 ? (
          <li className="flex flex-1 flex-col">
            <Empty className="border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarRange aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.academics_terms_empty()}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </li>
        ) : null}
        {terms.toReversed().map((term) => (
          <li key={term.id}>
            <HistoryLink
              href={termPath(programId, term.id)}
              // The status bar is a straight-edged child; the row's rounded corners clip it.
              className={cn(
                'flex items-stretch gap-3 overflow-hidden rounded-xl transition-colors',
                term.is_current
                  ? 'bg-primary/10 hover:bg-primary/15'
                  : 'bg-muted/60 hover:bg-muted',
              )}
            >
              <span
                aria-hidden
                className={cn('w-1 shrink-0', term.is_current ? 'bg-primary' : 'bg-border')}
              />
              <span className="min-w-0 flex-1 py-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{term.name}</span>
                  {term.is_current ? (
                    <Badge className="bg-primary/10 text-primary">
                      {m.academics_term_current_badge()}
                    </Badge>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {day(term.start_date)} – {day(term.end_date)}
                </span>
              </span>
              <span className="shrink-0 self-center pr-3 text-xs text-muted-foreground">
                {m.academics_course_count({ count: term.course_count })}
              </span>
            </HistoryLink>
          </li>
        ))}
      </ol>
      <div>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<HistoryLink href={newTermPath(programId)} />}
        >
          <CalendarPlus aria-hidden />
          {m.academics_term_new()}
        </Button>
      </div>
    </div>
  )
}
