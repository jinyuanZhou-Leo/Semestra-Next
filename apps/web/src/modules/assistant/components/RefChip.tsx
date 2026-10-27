import type { Course } from '@semestra/api-client'
import { BookOpen, CalendarRange, Minimize2, Sparkles } from 'lucide-react'
import { createContext, use } from 'react'
import { courseColor } from '@/modules/academics/color'
import { cn } from '@/lib/utils'
import type { Chip } from '../prompt'

/** The Program's courses, for the colour of course chips. */
export const ChipCourses = createContext<readonly Course[]>([])

/**
 * A skill, `/compact` or a course or term inside the text (M12 §6.1): in the input, where it is
 * removed as a whole, and in the sent message.
 */
export function RefChip({ chip, selected = false }: { chip: Chip; selected?: boolean }) {
  const courses = use(ChipCourses)
  const course = chip.kind === 'course' ? courses.find((c) => c.id === chip.id) : undefined
  return (
    <span
      data-chip={chip.kind}
      className={cn(
        'mx-px inline-flex h-5 items-center gap-1 rounded-md px-1.5 align-[-0.25em] text-[0.8125rem] font-medium whitespace-nowrap select-none [&>svg]:size-3.5 [&>svg]:shrink-0',
        chip.kind === 'skill' || chip.kind === 'command'
          ? 'bg-primary/12 text-primary dark:bg-primary/35 dark:text-foreground'
          : 'bg-foreground/7 text-foreground',
        selected && 'ring-2 ring-ring/50',
      )}
    >
      {chip.kind === 'skill' ? (
        <Sparkles aria-hidden />
      ) : chip.kind === 'command' ? (
        <Minimize2 aria-hidden />
      ) : chip.kind === 'term' ? (
        <CalendarRange aria-hidden />
      ) : (
        <BookOpen aria-hidden style={course ? { color: courseColor(course) } : undefined} />
      )}
      {chip.label}
    </span>
  )
}
