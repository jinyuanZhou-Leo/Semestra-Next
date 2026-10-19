import type {
  CategoryTemplate,
  GradingScale,
  ScaleBand,
  ScaleUpdateInputBody,
} from '@semestra/api-client'
import { gradingScaleUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { useAutosave } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemGroup } from '@/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Switch } from '@/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CategoryColorSelect } from '../components/CategoryColorSelect'
import { PresetSelect } from '../components/PresetSelect'
import { invalidateGrading, useGradingScale, useScalePresets } from '../queries'
import { SettingRow } from './rows'

/** Program "GPA and grades" settings (M03 §5.4): conversion table, year courses, defaults, privacy. */
export function ProgramGradingSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  return (
    <AsyncBoundary query={useGradingScale(programId)}>
      {(scale) => <ProgramGrading key={scale.program_id} scale={scale} />}
    </AsyncBoundary>
  )
}

function ProgramGrading({ scale }: { scale: GradingScale }) {
  const queryClient = useQueryClient()
  const update = useMutation({ ...gradingScaleUpdateMutation() })
  const { queue } = useAutosave<ScaleUpdateInputBody>({
    save: async (body) => {
      try {
        await update.mutateAsync({ path: { program_id: scale.program_id }, body })
      } catch (error) {
        toastError(error)
        throw error
      }
      await invalidateGrading(queryClient)
    },
  })
  const attributionId = useId()
  const forecastId = useId()
  const hideId = useId()
  const [attribution, setAttribution] = useState(scale.year_course_attribution)
  const [forecast, setForecast] = useState(scale.default_forecast_model)
  const [hide, setHide] = useState(scale.hide_gpa)
  const forecastItems = [
    { value: 'auto', label: m.grading_forecast_auto() },
    { value: 'simple_minimum_needed', label: m.grading_forecast_simple() },
  ]
  return (
    <div className="space-y-6">
      <BandEditor key={JSON.stringify([scale.bands, scale.max_points])} scale={scale} />
      <ItemGroup className="gap-0 divide-y divide-border rounded-2xl border">
        <SettingRow
          label={m.grading_year_rule()}
          labelId={attributionId}
          description={m.grading_year_rule_hint()}
        >
          <ToggleGroup
            aria-labelledby={attributionId}
            variant="outline"
            size="sm"
            value={[attribution]}
            onValueChange={([picked]) => {
              if (!picked) return
              const next = picked === 'split_evenly' ? 'split_evenly' : 'end_term'
              setAttribution(next)
              queue({ year_course_attribution: next })
            }}
          >
            <ToggleGroupItem value="end_term">{m.grading_year_rule_end_term()}</ToggleGroupItem>
            <ToggleGroupItem value="split_evenly">{m.grading_year_rule_split()}</ToggleGroupItem>
          </ToggleGroup>
        </SettingRow>
        <SettingRow
          label={m.grading_default_forecast()}
          labelId={forecastId}
          description={m.grading_default_forecast_hint()}
        >
          <Select
            value={forecast}
            items={forecastItems}
            onValueChange={(next) => {
              const model = next === 'simple_minimum_needed' ? next : 'auto'
              setForecast(model)
              queue({ default_forecast_model: model })
            }}
          >
            <SelectTrigger aria-labelledby={forecastId} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {forecastItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label={m.grading_hide_gpa()}
          labelId={hideId}
          description={m.grading_hide_gpa_hint()}
        >
          <Switch
            aria-labelledby={hideId}
            checked={hide}
            onCheckedChange={(on) => {
              setHide(on)
              queue({ hide_gpa: on })
            }}
          />
        </SettingRow>
      </ItemGroup>
      <DefaultCategories
        initial={scale.default_categories}
        onChange={(templates) => queue({ default_categories: templates })}
      />
    </div>
  )
}

type BandRow = { min: string; max: string; points: string; letter: string }

const toRows = (bands: readonly ScaleBand[]): BandRow[] =>
  bands
    .toSorted((a, b) => a.min - b.min)
    .map((b) => ({
      min: String(b.min),
      max: String(b.max),
      points: String(b.points),
      letter: b.letter ?? '',
    }))

/** The conversion table: a bar showing the ranges, an editable table, and preset reset. */
function BandEditor({ scale }: { scale: GradingScale }) {
  const maxPointsId = useId()
  const queryClient = useQueryClient()
  const presets = useScalePresets().data?.items
  const [rows, setRows] = useState(() => toRows(scale.bands))
  const [maxPoints, setMaxPoints] = useState(String(scale.max_points))
  const [presetId, setPresetId] = useState('uoft_4_0')
  const [confirming, setConfirming] = useState(false)
  const save = useMutation({
    ...gradingScaleUpdateMutation(),
    onError: toastError,
    onSuccess: async () => {
      setConfirming(false)
      await invalidateGrading(queryClient)
    },
  })
  const bands: ScaleBand[] = rows.map((r) => ({
    min: Number(r.min),
    max: Number(r.max),
    points: Number(r.points),
    letter: r.letter.trim() || null,
  }))
  const valid =
    Number(maxPoints) > 0 &&
    rows.length > 0 &&
    rows.every((r) => r.min !== '' && r.max !== '' && r.points !== '') &&
    bands.every((b) => [b.min, b.max, b.points].every(Number.isFinite))
  const dirty =
    JSON.stringify([rows, maxPoints]) !==
    JSON.stringify([toRows(scale.bands), String(scale.max_points)])
  const edit = (i: number, patch: Partial<BandRow>) =>
    setRows(rows.map((r, index) => (index === i ? { ...r, ...patch } : r)))
  const preset = presets?.find((p) => p.id === presetId)

  return (
    <section className="space-y-3" aria-label={m.grading_scale()}>
      <div>
        <h3 className="font-heading text-sm font-medium">{m.grading_scale()}</h3>
        <p className="text-xs text-muted-foreground">{m.grading_scale_hint()}</p>
      </div>
      <div className="flex h-8 overflow-hidden rounded-xl border border-border" aria-hidden>
        {valid
          ? bands
              .toSorted((a, b) => a.min - b.min)
              .map((b) => (
                <div
                  key={`${b.min}-${b.max}`}
                  title={`${b.min}–${b.max}%`}
                  className="flex min-w-0 items-center justify-center border-r border-background bg-primary text-[11px] text-primary-foreground last:border-r-0"
                  style={{
                    flexGrow: Math.max(b.max - b.min + 1, 1),
                    opacity: 0.25 + 0.75 * (b.points / Number(maxPoints)),
                  }}
                >
                  {b.letter ?? b.points}
                </div>
              ))
          : null}
      </div>
      <div className="rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {[
                m.grading_band_min(),
                m.grading_band_max(),
                m.grading_band_points(),
                m.grading_band_letter(),
              ].map((label) => (
                <TableHead key={label} className="h-10 text-xs text-muted-foreground">
                  {label}
                </TableHead>
              ))}
              <TableHead className="w-10">
                <span className="sr-only">{m.grading_actions()}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              // Rows have no identity of their own; they are edited in place.
              // oxlint-disable-next-line react/no-array-index-key
              <TableRow key={i}>
                {(['min', 'max', 'points', 'letter'] as const).map((field) => (
                  <TableCell key={field} className="py-1">
                    <Input
                      aria-label={`${m.grading_band()} ${i + 1}: ${field}`}
                      inputMode={field === 'letter' ? 'text' : 'decimal'}
                      value={row[field]}
                      maxLength={field === 'letter' ? 8 : undefined}
                      onChange={(event) => edit(i, { [field]: event.target.value })}
                      className="h-8 w-24 tabular-nums"
                    />
                  </TableCell>
                ))}
                <TableCell className="py-1">
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    aria-label={`${m.grading_band_remove()} ${i + 1}`}
                    onClick={() => setRows(rows.filter((_, index) => index !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, { min: '', max: '', points: '', letter: '' }])}
        >
          <Plus aria-hidden />
          {m.grading_band_add()}
        </Button>
        <Field orientation="horizontal" className="w-auto">
          <FieldLabel htmlFor={maxPointsId} className="font-normal text-muted-foreground">
            {m.grading_max_points()}
          </FieldLabel>
          <Input
            id={maxPointsId}
            inputMode="decimal"
            value={maxPoints}
            onChange={(event) => setMaxPoints(event.target.value)}
            className="h-8 w-20 tabular-nums"
          />
        </Field>
        <Button
          size="sm"
          disabled={!valid || !dirty || save.isPending}
          onClick={() =>
            save.mutate({
              path: { program_id: scale.program_id },
              body: { bands, max_points: Number(maxPoints) },
            })
          }
        >
          {save.isPending ? m.common_saving() : m.grading_scale_save()}
        </Button>
        <span className="flex-1" />
        <PresetSelect
          label={m.grading_preset()}
          ids={presets?.map((p) => p.id) ?? [presetId]}
          value={presetId}
          onChange={setPresetId}
          className="w-52"
        />
        <Button variant="outline" size="sm" disabled={!preset} onClick={() => setConfirming(true)}>
          {m.grading_preset_reset()}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={m.grading_preset_reset()}
        description={m.grading_preset_reset_confirm()}
        confirmLabel={m.grading_preset_reset()}
        pending={save.isPending}
        onConfirm={() =>
          preset &&
          save.mutate({
            path: { program_id: scale.program_id },
            body: { bands: preset.bands, max_points: preset.max_points },
          })
        }
      />
    </section>
  )
}

/** Categories every new course of the Program starts with. */
function DefaultCategories({
  initial,
  onChange,
}: {
  initial: readonly CategoryTemplate[]
  onChange: (templates: CategoryTemplate[]) => void
}) {
  const [items, setItems] = useState<CategoryTemplate[]>([...initial])
  const [draft, setDraft] = useState('')
  const apply = (next: CategoryTemplate[]) => {
    setItems(next)
    if (next.every((t) => t.name.trim() !== '')) onChange(next)
  }
  const add = () => {
    const name = draft.trim()
    if (name === '') return
    const taken = new Set(items.map((t) => t.key))
    const base =
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-+|-+$/g, '') || 'category'
    let key = base.slice(0, 28)
    for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 26)}-${n}`
    apply([...items, { key, name, color: 'slate' }])
    setDraft('')
  }
  return (
    <section className="space-y-3" aria-label={m.grading_default_categories()}>
      <div>
        <h3 className="font-heading text-sm font-medium">{m.grading_default_categories()}</h3>
        <p className="text-xs text-muted-foreground">{m.grading_default_categories_hint()}</p>
      </div>
      <ItemGroup className="gap-0 divide-y divide-border rounded-2xl border">
        {items.map((item, i) => (
          <Item key={item.key} size="sm">
            <Input
              aria-label={m.grading_category_name()}
              value={item.name}
              onChange={(event) =>
                apply(
                  items.map((t, index) => (index === i ? { ...t, name: event.target.value } : t)),
                )
              }
              className="h-8 max-w-60 flex-1"
            />
            <CategoryColorSelect
              label={m.grading_category_color()}
              value={item.color}
              onChange={(color) =>
                apply(items.map((t, index) => (index === i ? { ...t, color } : t)))
              }
            />
            <Button
              variant="destructive"
              size="icon-sm"
              aria-label={`${m.grading_category_remove()}: ${item.name}`}
              onClick={() => apply(items.filter((_, index) => index !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </Item>
        ))}
        <Item
          size="sm"
          render={
            <form
              onSubmit={(event) => {
                event.preventDefault()
                add()
              }}
            />
          }
        >
          <Input
            aria-label={m.grading_category_new()}
            placeholder={m.grading_category_new()}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="h-8 max-w-60 flex-1"
          />
          <Button type="submit" variant="outline" size="sm" disabled={draft.trim() === ''}>
            <Plus aria-hidden />
            {m.grading_category_add()}
          </Button>
        </Item>
      </ItemGroup>
    </section>
  )
}
