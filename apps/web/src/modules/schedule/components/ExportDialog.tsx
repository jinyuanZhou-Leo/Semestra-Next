import type { Course, Meeting, Occurrence, TermWeek } from '@semestra/api-client'
import { calendarOccurrenceListOptions } from '@semestra/api-client/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarArrowDown, Image as ImageIcon, Link2, type LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { CalendarSourceContribution } from '@/app/extensions'
import { SettingRow, SettingsBlock, SettingsGroup } from '@/app/settings'
import { ChoiceControl } from '@/app/settings/choice'
import { downloadFile, saveFile } from '@/lib/api-extras'
import { toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Switch } from '@/ui/switch'
import { pngsToPdf, renderPng } from '../export'
import { weekLabel } from '../labels'
import { weekGridItems } from '../occurrence'
import type { CalendarSettings } from '../queries'
import { dayInWeek, localDay, plusDays, wallDate } from '../time'
import { FeedPanel } from './FeedPanel'
import { meetingGridItems } from './TimetableView'
import { type GridDay, WeekGrid, minutes, weekDays } from './WeekGrid'

/** The widest range the calendar answers in one request (the API's `MAX_RANGE_DAYS`). */
const MAX_RANGE_DAYS = 120

/** What leaves the calendar: a picture, a one-off .ics file, or a subscription link. */
export type ShareKind = 'image' | 'ics' | 'feed'

type Format = 'png' | 'pdf'
type Range = 'week' | 'weeks' | 'term' | 'template'
type Sheet = {
  key: string
  title: string
  days: GridDay[]
  items: ReturnType<typeof weekGridItems>
}

export type ShareProps = {
  programId: string
  termId: string
  termName: string
  timezone: string
  weeks: readonly TermWeek[]
  currentWeekStart: string
  courses: readonly Course[]
  meetings: readonly Meeting[]
  /** The meetings are still loading: the timetable template waits for them. */
  meetingsPending?: boolean
  sources: readonly CalendarSourceContribution[]
  defaultSources: readonly string[]
  hiddenCourses: readonly string[]
  settings: CalendarSettings
}

export const SHARE_KINDS: readonly {
  kind: ShareKind
  icon: LucideIcon
  label: () => string
  description: () => string
}[] = [
  {
    kind: 'image',
    icon: ImageIcon,
    label: () => m.schedule_share_image(),
    description: () => m.schedule_share_image_description(),
  },
  {
    kind: 'ics',
    icon: CalendarArrowDown,
    label: () => m.schedule_share_ics(),
    description: () => m.schedule_share_ics_description(),
  },
  {
    kind: 'feed',
    icon: Link2,
    label: () => m.schedule_share_feed(),
    description: () => m.schedule_share_feed_description(),
  },
]

const TITLES: Record<ShareKind, () => string> = {
  image: () => m.schedule_export_image_title(),
  ics: () => m.schedule_export_ics_title(),
  feed: () => m.schedule_feeds(),
}

/**
 * Export and subscribe (M04 §5.4). `kind` picks the panel; with `pick` the dialog shows the three
 * ways as radio cards on top (one dialog for all), without it the dialog is just that panel
 * (opened from the toolbar menu).
 */
export function ShareDialog({
  kind,
  onKindChange,
  open,
  onOpenChange,
  ...props
}: ShareProps & {
  kind: ShareKind
  onKindChange: (kind: ShareKind) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const close = () => onOpenChange(false)
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={kind === 'image' ? 'sm:max-w-6xl' : 'sm:max-w-xl'}>
        <DialogHeader>
          <DialogTitle>{TITLES[kind]()}</DialogTitle>
          {kind === 'ics' ? (
            <DialogDescription>{m.schedule_export_ics_description()}</DialogDescription>
          ) : null}
          {kind === 'feed' ? (
            <DialogDescription>{m.schedule_feeds_description()}</DialogDescription>
          ) : null}
        </DialogHeader>
        {kind === 'image' ? (
          <ImagePanel {...props} busy={busy} setBusy={setBusy} onDone={close} />
        ) : kind === 'ics' ? (
          <IcsPanel
            {...props}
            busy={busy}
            setBusy={setBusy}
            onDone={close}
            onUseFeed={() => onKindChange('feed')}
          />
        ) : (
          <FeedPanel programId={props.programId} />
        )}
      </DialogContent>
    </Dialog>
  )
}

type PanelProps = ShareProps & {
  busy: boolean
  setBusy: (busy: boolean) => void
  onDone: () => void
}

/** The week the calendar shows, else the next one, else the first. */
function currentWeek(weeks: readonly TermWeek[], start: string): TermWeek | undefined {
  return (
    weeks.find((w) => w.start_date <= start && start <= w.end_date) ??
    weeks.find((w) => w.start_date >= start) ??
    weeks[0]
  )
}

/** The weeks of a range: one, from–to, or all of the term. */
function useWeekRange(weeks: readonly TermWeek[], currentWeekStart: string) {
  const current = currentWeek(weeks, currentWeekStart)
  const [from, setFrom] = useState(current?.start_date ?? '')
  const [to, setTo] = useState(current?.start_date ?? '')
  const pick = (range: Range) => {
    if (range === 'term') return weeks
    const last = range === 'weeks' && to >= from ? to : from
    return weeks.filter((w) => w.start_date >= from && w.start_date <= last)
  }
  return { from, setFrom, to, setTo, pick }
}

/** The week rows of a range: one week, or from–to; none for the whole term or the template. */
function weekRows({
  range,
  weeks,
  from,
  to,
  setFrom,
  setTo,
}: {
  range: Range
  weeks: readonly TermWeek[]
  from: string
  to: string
  setFrom: (value: string) => void
  setTo: (value: string) => void
}) {
  if (range !== 'week' && range !== 'weeks') return []
  const options = weeks.map((w) => ({
    value: w.start_date,
    label: `${weekLabel(w.number, w.break_info?.name)} · ${formatDate(localDay(w.start_date))}`,
  }))
  const row = (
    key: string,
    label: string,
    value: string,
    items: typeof options,
    onChange: (value: string) => void,
  ) => (
    <SettingRow size="sm" key={key} label={label}>
      {(labelId) => (
        <Select value={value} items={items} onValueChange={(next) => next && onChange(next)}>
          <SelectTrigger aria-labelledby={labelId} className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  )
  return range === 'weeks'
    ? [
        row('from', m.schedule_export_from(), from, options, setFrom),
        row(
          'to',
          m.schedule_export_to(),
          to,
          options.filter((option) => option.value >= from),
          setTo,
        ),
      ]
    : [row('week', m.schedule_export_week(), from, options, setFrom)]
}

/** One switch per calendar source, as in the calendar's own filter. */
function SourceGroup({
  sources,
  picked,
  setPicked,
}: {
  sources: readonly CalendarSourceContribution[]
  picked: ReadonlySet<string>
  setPicked: (next: ReadonlySet<string>) => void
}) {
  return (
    <SettingsBlock title={m.schedule_export_content()}>
      <SettingsGroup>
        {sources.map((s) => (
          <SettingRow key={s.source} size="sm" label={s.label()}>
            {(labelId) => (
              <Switch
                aria-labelledby={labelId}
                checked={picked.has(s.source)}
                onCheckedChange={(on) => {
                  const next = new Set(picked)
                  if (on) next.add(s.source)
                  else next.delete(s.source)
                  setPicked(next)
                }}
              />
            )}
          </SettingRow>
        ))}
      </SettingsGroup>
    </SettingsBlock>
  )
}

function rangeOf(weeks: readonly TermWeek[], fallback: string) {
  const start = weeks[0]?.start_date ?? fallback
  const end = plusDays(weeks.at(-1)?.end_date ?? fallback, 1)
  return { start, end }
}

/** PNG or PDF rendered in the browser, with a preview of the first page. */
function ImagePanel({
  programId,
  termId,
  termName,
  timezone,
  weeks,
  currentWeekStart,
  courses,
  meetings,
  meetingsPending = false,
  sources,
  defaultSources,
  hiddenCourses,
  settings,
  busy,
  setBusy,
  onDone,
}: PanelProps) {
  const queryClient = useQueryClient()
  const sheetRefs = useRef(new Map<string, HTMLDivElement>())
  const [format, setFormat] = useState<Format>('png')
  const [range, setRange] = useState<Range>('week')
  const weekRange = useWeekRange(weeks, currentWeekStart)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(defaultSources))
  const [cancelled, setCancelled] = useState(settings.cancelled_display)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [sheets, setSheets] = useState<Sheet[] | null>(null)

  const selectedWeeks = range === 'template' ? [] : weekRange.pick(range)
  const hidden = new Set(hiddenCourses)
  const wanted = sources.filter((s) => picked.has(s.source)).map((s) => s.source)
  const fromDay = weekRange.from

  const occurrenceQuery = (part: { start: string; end: string }) =>
    calendarOccurrenceListOptions({
      path: { program_id: programId },
      query: { ...part, term_id: termId, sources: wanted },
    })
  const visible = (items: readonly Occurrence[]) =>
    items.filter((o) => !o.course_id || !hidden.has(o.course_id))

  const sheetOf = (week: TermWeek, items: readonly Occurrence[]): Sheet => {
    const inWeek = items.filter((o) => {
      const day = wallDate(o.start_at, timezone)
      return day >= week.start_date && day <= week.end_date
    })
    return {
      key: week.start_date,
      title: `${termName} · ${weekLabel(week.number, week.break_info?.name)} · ${formatDate(
        localDay(week.start_date),
      )} – ${formatDate(localDay(week.end_date))}`,
      // In the term's own week order, so the dates run left to right whatever day it starts on.
      days: weekDays(settings.show_weekends)
        .map((d) => ({ ...d, date: dayInWeek(week.start_date, d.weekday) }))
        .toSorted((a, b) => a.date.localeCompare(b.date))
        .map(({ date, ...d }) => ({ ...d, sublabel: String(localDay(date).getDate()) })),
      items: weekGridItems(inWeek, timezone),
    }
  }
  const templateSheet = (): Sheet => ({
    key: 'template',
    title: `${termName} · ${m.schedule_view_timetable()}`,
    days: weekDays(settings.show_weekends || meetings.some((mt) => mt.enabled && mt.weekday >= 6)),
    items: meetingGridItems(
      meetings.filter((mt) => !hidden.has(mt.course_id)),
      courses,
      new Set(),
    ),
  })

  // The preview is the first page: the first selected week (or the weekly timetable).
  const firstWeek = selectedWeeks[0]
  const preview = useQuery({
    ...occurrenceQuery(rangeOf(firstWeek ? [firstWeek] : [], fromDay)),
    enabled: range !== 'template' && firstWeek !== undefined && wanted.length > 0,
  })
  const previewSheet =
    range === 'template'
      ? templateSheet()
      : firstWeek
        ? sheetOf(firstWeek, visible(wanted.length > 0 ? (preview.data?.items ?? []) : []))
        : null

  const fetchWeeks = async (): Promise<Occurrence[]> => {
    const { start, end } = rangeOf(selectedWeeks, fromDay)
    // The calendar answers at most MAX_RANGE_DAYS at a time; a long term is asked in parts.
    const parts: { start: string; end: string }[] = []
    for (let day = start; day < end; day = plusDays(day, MAX_RANGE_DAYS)) {
      const next = plusDays(day, MAX_RANGE_DAYS)
      parts.push({ start: day, end: next < end ? next : end })
    }
    const pages = await Promise.all(
      parts.map((part) => queryClient.fetchQuery(occurrenceQuery(part))),
    )
    // An item that spans two parts comes back in both.
    const byId = new Map(pages.flatMap((page) => page.items).map((o) => [o.id, o]))
    return visible([...byId.values()])
  }

  const exportFile = async () => {
    const built =
      range === 'template'
        ? [templateSheet()]
        : await fetchWeeks().then((items) => selectedWeeks.map((week) => sheetOf(week, items)))
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
    onDone()
  }
  const run = async () => {
    setBusy(true)
    await exportFile().catch(toastError)
    setSheets(null)
    setBusy(false)
  }

  const pages = range === 'template' ? 1 : selectedWeeks.length

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_36rem]">
        <figure className="flex min-w-0 flex-col gap-2">
          <div
            className={cn(
              theme,
              'overflow-hidden rounded-xl border bg-background p-3 text-foreground shadow-xs',
            )}
          >
            {previewSheet ? (
              <>
                <p className="mb-2 truncate font-heading text-xs font-semibold">
                  {previewSheet.title}
                </p>
                <WeekGrid
                  days={previewSheet.days}
                  items={previewSheet.items}
                  dayStart={minutes(settings.day_start)}
                  dayEnd={minutes(settings.day_end)}
                  hourHeight={26}
                  compact
                  hideCancelled={cancelled === 'hide'}
                  className="pointer-events-none text-[0.6rem]"
                />
              </>
            ) : null}
          </div>
          <figcaption className="text-xs text-muted-foreground">
            {pages > 1
              ? m.schedule_export_preview_more({ count: pages })
              : m.schedule_export_preview()}
          </figcaption>
        </figure>
        <div className="flex max-h-[min(40rem,75vh)] flex-col gap-4 overflow-y-auto">
          <SettingsGroup>
            {[
              <SettingRow
                size="sm"
                key="format"
                label={m.schedule_export_format()}
                description={
                  format === 'png' ? m.schedule_export_png_hint() : m.schedule_export_pdf_hint()
                }
              >
                {(labelId) => (
                  <ChoiceControl<Format>
                    labelId={labelId}
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: 'png', label: 'PNG' },
                      { value: 'pdf', label: 'PDF' },
                    ]}
                  />
                )}
              </SettingRow>,
              <SettingRow size="sm" key="range" label={m.schedule_export_range()}>
                {(labelId) => (
                  <ChoiceControl<Range>
                    labelId={labelId}
                    value={range}
                    onChange={setRange}
                    options={[
                      { value: 'week', label: m.schedule_export_one_week() },
                      { value: 'weeks', label: m.schedule_export_weeks() },
                      { value: 'template', label: m.schedule_export_template() },
                    ]}
                  />
                )}
              </SettingRow>,
              ...weekRows({ range, weeks, ...weekRange }),
            ]}
          </SettingsGroup>
          {range !== 'template' ? (
            <SourceGroup sources={sources} picked={picked} setPicked={setPicked} />
          ) : null}
          <SettingsGroup>
            <SettingRow size="sm" label={m.schedule_export_cancelled()}>
              {(labelId) => (
                <ChoiceControl<typeof cancelled>
                  labelId={labelId}
                  value={cancelled}
                  onChange={setCancelled}
                  options={[
                    {
                      value: 'strike',
                      label: m.settings_calendar_cancelled_display_option_strike(),
                    },
                    { value: 'hide', label: m.settings_calendar_cancelled_display_option_hide() },
                  ]}
                />
              )}
            </SettingRow>
            <SettingRow size="sm" label={m.schedule_export_theme()}>
              {(labelId) => (
                <ChoiceControl<'light' | 'dark'>
                  labelId={labelId}
                  value={theme}
                  onChange={setTheme}
                  options={[
                    { value: 'light', label: m.schedule_export_theme_light() },
                    { value: 'dark', label: m.schedule_export_theme_dark() },
                  ]}
                />
              )}
            </SettingRow>
          </SettingsGroup>
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={
            busy || (range === 'template' ? meetingsPending : wanted.length === 0 || !fromDay)
          }
          onClick={() => void run()}
        >
          {busy ? m.schedule_exporting() : m.schedule_export_save({ format: format.toUpperCase() })}
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
    </>
  )
}

/** A one-off .ics file from the API. */
function IcsPanel({
  programId,
  termId,
  weeks,
  currentWeekStart,
  sources,
  defaultSources,
  hiddenCourses,
  busy,
  setBusy,
  onDone,
  onUseFeed,
}: PanelProps & { onUseFeed: () => void }) {
  const [range, setRange] = useState<Range>('term')
  const weekRange = useWeekRange(weeks, currentWeekStart)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(defaultSources))
  const wanted = sources.filter((s) => picked.has(s.source)).map((s) => s.source)

  const download = async () => {
    const { start, end } = rangeOf(weekRange.pick(range), weekRange.from)
    const blob = await downloadFile(`/programs/${programId}/calendar.ics`, {
      start,
      end,
      term_id: termId,
      sources: wanted,
      exclude_course_ids: [...hiddenCourses],
    })
    saveFile(blob, 'semestra.ics')
    onDone()
  }
  const run = async () => {
    setBusy(true)
    await download().catch(toastError)
    setBusy(false)
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        <SettingsGroup>
          {[
            <SettingRow size="sm" key="range" label={m.schedule_export_range()}>
              {(labelId) => (
                <ChoiceControl<Range>
                  labelId={labelId}
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: 'term', label: m.schedule_export_whole_term() },
                    { value: 'week', label: m.schedule_export_one_week() },
                    { value: 'weeks', label: m.schedule_export_weeks() },
                  ]}
                />
              )}
            </SettingRow>,
            ...weekRows({ range, weeks, ...weekRange }),
          ]}
        </SettingsGroup>
        <SourceGroup sources={sources} picked={picked} setPicked={setPicked} />
      </div>
      <DialogFooter className="sm:justify-between">
        <Button variant="link" className="px-0" onClick={onUseFeed}>
          <Link2 aria-hidden />
          {m.schedule_export_ics_use_feed()}
        </Button>
        <Button disabled={busy || wanted.length === 0} onClick={() => void run()}>
          {busy ? m.schedule_exporting() : m.schedule_export_ics_download()}
        </Button>
      </DialogFooter>
    </>
  )
}
