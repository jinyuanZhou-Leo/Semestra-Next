import { CalendarRange, Pin, X } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { HistoryLink } from '@/components/HistoryLink'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { courseColor, courseLabel } from '../color'
import { coursePath, termPath } from '../paths'
import { type Pin as PinRef, usePins } from '../pins'
import { useCourses, useTerms } from '../queries'

type Item = { pin: PinRef; label: string; sublabel?: string; href: string; dot?: string }

/** Pinned terms and courses as small tiles, reordered by dragging (M02 §5.2, the old Focus Board). */
export default function PinnedCard({ scope }: CardProps) {
  const programId = scope.programId
  const { pins, setPins, toggle } = usePins(programId)
  const terms = useTerms(programId).data?.items ?? []
  const courses = useCourses(programId).data?.items ?? []
  const [dragging, setDragging] = useState<number | null>(null)

  const items: Item[] = pins.flatMap((pin): Item[] => {
    if (pin.kind === 'term') {
      const term = terms.find((t) => t.id === pin.id)
      return term
        ? [
            {
              pin,
              label: term.name,
              sublabel: m.academics_course_count({ count: term.course_count }),
              href: termPath(programId, term.id),
            },
          ]
        : []
    }
    const course = courses.find((c) => c.id === pin.id)
    return course
      ? [
          {
            pin,
            label: courseLabel(course),
            sublabel: course.code ? course.title : undefined,
            href: coursePath(programId, course.id),
            dot: courseColor(course),
          },
        ]
      : []
  })

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
        <Pin aria-hidden className="size-5" />
        {m.academics_pinned_empty()}
      </div>
    )
  }

  const drop = (event: DragEvent, to: number) => {
    event.preventDefault()
    if (dragging === null || dragging === to) return
    const moved = items[dragging]
    if (!moved) return
    const order = items.map((item) => item.pin).filter((_, i) => i !== dragging)
    order.splice(to, 0, moved.pin)
    setPins(order)
    setDragging(null)
  }

  return (
    <ul aria-label={m.academics_pinned()} className="flex h-full gap-3 overflow-x-auto pb-1">
      {items.map((item, index) => (
        <li key={`${item.pin.kind}:${item.pin.id}`} className="group relative w-40 shrink-0">
          <HistoryLink
            href={item.href}
            draggable
            onDragStart={() => setDragging(index)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, index)}
            className={cn(
              'flex h-full flex-col gap-1 rounded-2xl border border-border bg-background p-3 hover:border-primary/50',
              dragging === index && 'opacity-50',
            )}
          >
            <span className="flex items-center gap-2 pr-4 font-medium">
              {item.dot ? (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.dot }}
                />
              ) : (
                <CalendarRange aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{item.label}</span>
            </span>
            {item.sublabel ? (
              <span className="line-clamp-2 text-xs text-muted-foreground">{item.sublabel}</span>
            ) : null}
          </HistoryLink>
          <button
            type="button"
            onClick={() => toggle(item.pin)}
            aria-label={m.academics_unpin_named({ name: item.label })}
            className="absolute top-1.5 right-1.5 rounded-full p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}
