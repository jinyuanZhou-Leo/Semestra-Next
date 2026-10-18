import type { Course } from '@semestra/api-client'
import type { CalendarSourceContribution } from '@/app/extensions'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { Switch } from '@/ui/switch'

/** The calendar's filters, saved per term (`calendar.filters.<termId>`, M04 §5.2). */
export type CalendarFilters = {
  /** Sources the user switched on or off; others follow their `defaultVisible`. */
  sources: Record<string, boolean>
  /** Hidden rather than shown, so a new course appears without touching the filters. */
  hiddenCourses: string[]
  /** null follows the "cancelled classes" preference. */
  showCancelled: boolean | null
}

export const DEFAULT_FILTERS: CalendarFilters = { sources: {}, hiddenCourses: [], showCancelled: null }

export function visibleSources(
  filters: CalendarFilters,
  sources: readonly CalendarSourceContribution[],
): string[] {
  return sources.filter((s) => filters.sources[s.source] ?? s.defaultVisible).map((s) => s.source)
}

export function FilterPanel({
  filters,
  onChange,
  sources,
  courses,
  showCancelled,
}: {
  filters: CalendarFilters
  onChange: (next: CalendarFilters) => void
  sources: readonly CalendarSourceContribution[]
  courses: readonly Course[]
  showCancelled: boolean
}) {
  const shown = new Set(visibleSources(filters, sources))
  const hidden = new Set(filters.hiddenCourses)
  return (
    <div className="space-y-5 text-sm">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          {m.schedule_filter_sources()}
        </legend>
        {sources.map((s) => (
          <label key={s.source} className="flex items-center gap-2">
            <Checkbox
              checked={shown.has(s.source)}
              onCheckedChange={(on) =>
                onChange({ ...filters, sources: { ...filters.sources, [s.source]: on } })
              }
            />
            <s.icon aria-hidden className="size-4 text-muted-foreground" />
            {s.label()}
          </label>
        ))}
      </fieldset>
      {courses.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">
            {m.schedule_filter_courses()}
          </legend>
          {courses.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <Checkbox
                checked={!hidden.has(c.id)}
                onCheckedChange={(on) =>
                  onChange({
                    ...filters,
                    hiddenCourses: on
                      ? filters.hiddenCourses.filter((id) => id !== c.id)
                      : [...filters.hiddenCourses, c.id],
                  })
                }
              />
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(c) }}
              />
              <span className="truncate">{courseLabel(c)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className="flex items-center justify-between gap-2">
        {m.schedule_filter_show_cancelled()}
        <Switch
          checked={showCancelled}
          onCheckedChange={(on) => onChange({ ...filters, showCancelled: on })}
        />
      </label>
    </div>
  )
}
