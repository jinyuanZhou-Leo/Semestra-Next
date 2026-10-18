import type { Course, Meeting, Occurrence, TermWeek } from '@semestra/api-client'
import { calendarOccurrencesOptions } from '@semestra/api-client/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { CalendarSourceContribution } from '@/app/extensions'
import { downloadFile, saveFile } from '@/lib/api-extras'
import { toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldLabel } from '@/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { pngsToPdf, renderPng } from '../export'
import { weekLabel } from '../labels'
import { weekGridItems } from '../occurrence'
import type { CalendarSettings } from '../queries'
import { dayInWeek, localDay, plusDays, wallDate } from '../time'
import { SimpleSelect } from './SimpleSelect'
import { meetingGridItems } from './TimetableView'
import { type GridDay, WeekGrid, minutes, weekDays } from './WeekGrid'

type Format = 'png' | 'pdf' | 'ics'
type Range = 'week' | 'weeks' | 'template'
type Sheet = {
  key: string
  title: string
  days: GridDay[]
  items: ReturnType<typeof weekGridItems>
}

/**
 * Export the schedule (M04 §5.4): PNG or PDF rendered in the browser (one A4 landscape page per
 * week), or an ICS file from the API. Options: weeks or the weekly template, sources, how
 * cancelled classes look, light or dark.
 */
export function ExportDialog({
  programId,
  termId,
  termName,
  timezone,
  weeks,
  currentWeekStart,
  courses,
  meetings,
  sources,
  defaultSources,
  hiddenCourses,
  settings,
  open,
  onOpenChange,
}: {
  programId: string
  termId: string
  termName: string
  timezone: string
  weeks: readonly TermWeek[]
  currentWeekStart: string
  courses: readonly Course[]
  meetings: readonly Meeting[]
  sources: readonly CalendarSourceContribution[]
  defaultSources: readonly string[]
  hiddenCourses: readonly string[]
  settings: CalendarSettings
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const sheetRefs = useRef(new Map<string, HTMLDivElement>())
  const current =
    weeks.find((w) => w.start_date <= currentWeekStart && currentWeekStart <= w.end_date) ??
    weeks.find((w) => w.start_date >= currentWeekStart) ??
    weeks[0]
  const [format, setFormat] = useState<Format>('png')
  const [range, setRange] = useState<Range>('week')
  const [from, setFrom] = useState(current?.start_date ?? '')
  const [to, setTo] = useState(current?.start_date ?? '')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(defaultSources))
  const [cancelled, setCancelled] = useState(settings.cancelled_display)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [busy, setBusy] = useState(false)

  const effectiveRange: Range = format === 'ics' && range === 'template' ? 'week' : range
  const first = from
  const last = effectiveRange === 'weeks' && to >= from ? to : from
  const selectedWeeks = weeks.filter((w) => w.start_date >= first && w.start_date <= last)
  const hidden = new Set(hiddenCourses)
  const weekOptions = weeks.map((w) => ({
    value: w.start_date,
    label: `${weekLabel(w.number, w.break_info?.name)} · ${formatDate(localDay(w.start_date))}`,
  }))
  const wanted = sources.filter((s) => picked.has(s.source)).map((s) => s.source)

  const fetchWeeks = async (): Promise<Occurrence[]> => {
    const start = selectedWeeks[0]?.start_date ?? first
    const end = plusDays(selectedWeeks.at(-1)?.end_date ?? first, 1)
    const data = await queryClient.fetchQuery(
      calendarOccurrencesOptions({
        path: { program_id: programId },
        query: { start, end, term_id: termId, sources: wanted },
      }),
    )
    return data.items.filter((o) => !o.course_id || !hidden.has(o.course_id))
  }

  const buildSheets = async (): Promise<Sheet[]> => {
    const showWeekends = settings.show_weekends
    if (effectiveRange === 'template') {
      return [
        {
          key: 'template',
          title: `${termName} · ${m.schedule_view_timetable()}`,
          days: weekDays(showWeekends || meetings.some((mt) => mt.enabled && mt.weekday >= 6)),
          items: meetingGridItems(
            meetings.filter((mt) => !hidden.has(mt.course_id)),
            courses,
            new Set(),
          ),
        },
      ]
    }
    const items = await fetchWeeks()
    return selectedWeeks.map((week) => {
      const inWeek = items.filter((o) => {
        const day = wallDate(o.start_at, timezone)
        return day >= week.start_date && day <= week.end_date
      })
      const gridItems = weekGridItems(inWeek, timezone)
      return {
        key: week.start_date,
        title: `${termName} · ${weekLabel(week.number, week.break_info?.name)} · ${formatDate(
          localDay(week.start_date),
        )} – ${formatDate(localDay(week.end_date))}`,
        days: weekDays(showWeekends).map((d) => {
          const date = dayInWeek(week.start_date, d.weekday)
          return { ...d, sublabel: String(localDay(date).getDate()) }
        }),
        items: gridItems,
      }
    })
  }

  const run = async () => {
    setBusy(true)
    try {
      if (format === 'ics') {
        const start = selectedWeeks[0]?.start_date ?? first
        const end = plusDays(selectedWeeks.at(-1)?.end_date ?? first, 1)
        const blob = await downloadFile(`/programs/${programId}/calendar.ics`, {
          start,
          end,
          term_id: termId,
          sources: wanted,
          exclude_course_ids: [...hidden],
        })
        saveFile(blob, 'semestra.ics')
      } else {
        const built = await buildSheets()
        flushSync(() => setSheets(built))
        const nodes = built
          .map((s) => sheetRefs.current.get(s.key))
          .filter((n): n is HTMLDivElement => n !== undefined)
        if (format === 'png') {
          const stack = nodes[0]?.parentElement
          if (stack) saveFile(await renderPng(stack), 'semestra-schedule.png')
        } else {
          const pngs = []
          for (const node of nodes) pngs.push(await renderPng(node))
          saveFile(await pngsToPdf(pngs), 'semestra-schedule.pdf')
        }
      }
      onOpenChange(false)
    } catch (error) {
      toastError(error)
    } finally {
      setSheets(null)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.schedule_export()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup
            aria-label={m.schedule_export_format()}
            variant="outline"
            size="sm"
            value={[format]}
            onValueChange={(value) => value[0] && setFormat(value[0] as Format)}
          >
            <ToggleGroupItem value="png">PNG</ToggleGroupItem>
            <ToggleGroupItem value="pdf">PDF</ToggleGroupItem>
            <ToggleGroupItem value="ics">ICS</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            aria-label={m.schedule_export_range()}
            variant="outline"
            size="sm"
            value={[effectiveRange]}
            onValueChange={(value) => value[0] && setRange(value[0] as Range)}
          >
            <ToggleGroupItem value="week">{m.schedule_export_one_week()}</ToggleGroupItem>
            <ToggleGroupItem value="weeks">{m.schedule_export_weeks()}</ToggleGroupItem>
            {format === 'ics' ? null : (
              <ToggleGroupItem value="template">{m.schedule_view_timetable()}</ToggleGroupItem>
            )}
          </ToggleGroup>
          {effectiveRange !== 'template' && weekOptions.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor={`${fid}-1`}>
                  {effectiveRange === 'weeks' ? m.schedule_export_from() : m.schedule_export_week()}
                </FieldLabel>
                <SimpleSelect
                  id={`${fid}-1`}
                  value={from}
                  onChange={setFrom}
                  options={weekOptions}
                />
              </Field>
              {effectiveRange === 'weeks' ? (
                <Field>
                  <FieldLabel htmlFor={`${fid}-2`}>{m.schedule_export_to()}</FieldLabel>
                  <SimpleSelect
                    id={`${fid}-2`}
                    value={to}
                    onChange={setTo}
                    options={weekOptions.filter((o) => o.value >= from)}
                  />
                </Field>
              ) : null}
            </div>
          ) : null}
          {effectiveRange !== 'template' ? (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">{m.schedule_filter_sources()}</legend>
              {sources.map((s) => (
                <label key={s.source} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={picked.has(s.source)}
                    onCheckedChange={(on) => {
                      const next = new Set(picked)
                      if (on) next.add(s.source)
                      else next.delete(s.source)
                      setPicked(next)
                    }}
                  />
                  {s.label()}
                </label>
              ))}
            </fieldset>
          ) : null}
          {format !== 'ics' ? (
            <div className="flex flex-wrap gap-4">
              <div>
                <p className="mb-2 text-sm font-medium">{m.schedule_export_cancelled()}</p>
                <ToggleGroup
                  aria-label={m.schedule_export_cancelled()}
                  variant="outline"
                  size="sm"
                  value={[cancelled]}
                  onValueChange={(value) => value[0] && setCancelled(value[0] as typeof cancelled)}
                >
                  <ToggleGroupItem value="strike">
                    {m.settings_calendar_cancelled_display_option_strike()}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="hide">
                    {m.settings_calendar_cancelled_display_option_hide()}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">{m.schedule_export_theme()}</p>
                <ToggleGroup
                  aria-label={m.schedule_export_theme()}
                  variant="outline"
                  size="sm"
                  value={[theme]}
                  onValueChange={(value) => value[0] && setTheme(value[0] as 'light' | 'dark')}
                >
                  <ToggleGroupItem value="light">{m.schedule_export_theme_light()}</ToggleGroupItem>
                  <ToggleGroupItem value="dark">{m.schedule_export_theme_dark()}</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{m.schedule_export_ics_hint()}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={busy || (effectiveRange !== 'template' && (wanted.length === 0 || !from))}
            onClick={() => void run()}
          >
            {busy ? m.schedule_exporting() : m.schedule_export()}
          </Button>
        </DialogFooter>
        {sheets ? (
          <div aria-hidden className="pointer-events-none fixed top-0 -left-[10000px]">
            <div className={cn(theme, 'w-[1100px] space-y-6 bg-background p-6 text-foreground')}>
              {sheets.map((sheet) => (
                <div
                  key={sheet.key}
                  ref={(node) => {
                    if (node) sheetRefs.current.set(sheet.key, node)
                    else sheetRefs.current.delete(sheet.key)
                  }}
                  className="space-y-3 bg-background"
                >
                  <h2 className="font-heading text-lg font-semibold">{sheet.title}</h2>
                  <WeekGrid
                    days={sheet.days}
                    items={sheet.items}
                    dayStart={minutes(settings.day_start)}
                    dayEnd={minutes(settings.day_end)}
                    hourHeight={40}
                    hideCancelled={cancelled === 'hide'}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
