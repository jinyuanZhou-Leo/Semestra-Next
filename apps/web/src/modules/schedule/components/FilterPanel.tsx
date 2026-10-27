import type { Course } from '@semestra/api-client'
import { useId } from 'react'
import type { CalendarSourceContribution } from '@/app/extensions'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/ui/field'
import { Switch } from '@/ui/switch'
import { type CalendarFilters, visibleSources } from '../filters'

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
  const id = useId()
  const shown = new Set(visibleSources(filters, sources))
  const hidden = new Set(filters.hiddenCourses)
  return (
    <div className="space-y-5 text-sm">
      <FieldSet className="gap-2">
        <FieldLegend variant="label" className="text-xs text-muted-foreground">
          {m.schedule_filter_sources()}
        </FieldLegend>
        {sources.map((s) => (
          <Field key={s.source} orientation="horizontal" className="w-auto gap-2">
            <Checkbox
              id={`${id}-source-${s.source}`}
              checked={shown.has(s.source)}
              onCheckedChange={(on) =>
                onChange({ ...filters, sources: { ...filters.sources, [s.source]: on } })
              }
            />
            <FieldLabel htmlFor={`${id}-source-${s.source}`} className="font-normal">
              <s.icon aria-hidden className="size-4 text-muted-foreground" />
              {s.label()}
            </FieldLabel>
          </Field>
        ))}
      </FieldSet>
      {courses.length > 0 ? (
        <FieldSet className="gap-2">
          <FieldLegend variant="label" className="text-xs text-muted-foreground">
            {m.schedule_filter_courses()}
          </FieldLegend>
          {courses.map((c) => (
            <Field key={c.id} orientation="horizontal" className="w-auto gap-2">
              <Checkbox
                id={`${id}-course-${c.id}`}
                checked={!hidden.has(c.id)}
                onCheckedChange={(on) =>
                  onChange({
                    ...filters,
                    hiddenCourses: on
                      ? filters.hiddenCourses.filter((courseId) => courseId !== c.id)
                      : [...filters.hiddenCourses, c.id],
                  })
                }
              />
              <FieldLabel htmlFor={`${id}-course-${c.id}`} className="min-w-0 font-normal">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: courseColor(c) }}
                />
                <span className="truncate">{courseLabel(c)}</span>
              </FieldLabel>
            </Field>
          ))}
        </FieldSet>
      ) : null}
      <Field orientation="horizontal" className="justify-between">
        <FieldLabel htmlFor={`${id}-cancelled`} className="font-normal">
          {m.schedule_filter_show_cancelled()}
        </FieldLabel>
        <Switch
          id={`${id}-cancelled`}
          checked={showCancelled}
          onCheckedChange={(on) => onChange({ ...filters, showCancelled: on })}
        />
      </Field>
    </div>
  )
}
