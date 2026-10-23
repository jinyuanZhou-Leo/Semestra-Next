import type {
  CategoryTemplate,
  GradingScale,
  ScaleBand,
  ScalePreset,
  ScaleUpdateInputBody,
} from '@semestra/api-client'
import { gradingScaleUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Plus, Trash2 } from 'lucide-react'
import { createContext, use, useId, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  ActionRow,
  ChoiceControl,
  MoveMenuItems,
  RowMenu,
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  SettingsTable,
  settingsTableFeatures,
  useAutosave,
} from '@/app/settings'
import { focusOnMount } from '@/lib/focus'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Switch } from '@/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CategoryColorSelect } from '../components/CategoryColorSelect'
import { presetOptions } from '../presets'
import { invalidateGrading, useGradingScale, useScalePresets } from '../queries'
import { forecastOptions } from './forecast-options'

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
  const roundId = useId()
  const [attribution, setAttribution] = useState(scale.year_course_attribution)
  const [forecast, setForecast] = useState(scale.default_forecast_model)
  const [hide, setHide] = useState(scale.hide_gpa)
  const [round, setRound] = useState(scale.round_before_lookup)
  const forecastItems = forecastOptions()
  const attributionItems = [
    {
      value: 'end_term',
      label: m.grading_year_rule_end_term(),
      hint: m.grading_year_rule_end_term_hint(),
    },
    {
      value: 'split_evenly',
      label: m.grading_year_rule_split(),
      hint: m.grading_year_rule_split_hint(),
    },
  ] as const
  return (
    <div className="space-y-6">
      <BandEditor key={JSON.stringify([scale.bands, scale.max_points])} scale={scale} />
      <SettingsGroup>
        <SettingRow
          label={m.grading_year_rule()}
          labelId={attributionId}
          description={m.grading_year_rule_hint()}
        >
          <ChoiceControl
            labelId={attributionId}
            options={attributionItems}
            value={attribution}
            onChange={(next) => {
              setAttribution(next)
              queue({ year_course_attribution: next })
            }}
          />
        </SettingRow>
        <SettingRow
          label={m.grading_default_forecast()}
          labelId={forecastId}
          description={m.grading_default_forecast_hint()}
        >
          <ChoiceControl
            labelId={forecastId}
            options={forecastItems}
            value={forecast}
            onChange={(model) => {
              setForecast(model)
              queue({ default_forecast_model: model })
            }}
          />
        </SettingRow>
        <SettingRow
          label={m.grading_round_before_lookup()}
          labelId={roundId}
          description={m.grading_round_before_lookup_hint()}
        >
          <Switch
            aria-labelledby={roundId}
            checked={round}
            onCheckedChange={(on) => {
              setRound(on)
              queue({ round_before_lookup: on })
            }}
          />
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
      </SettingsGroup>
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

/** The preset the table is, or `custom` once it no longer matches one. */
const presetOf = (
  presets: readonly ScalePreset[] | undefined,
  rows: readonly BandRow[],
  maxPoints: string,
): string => {
  const table = JSON.stringify([rows, maxPoints])
  return (
    presets?.find((p) => JSON.stringify([toRows(p.bands), String(p.max_points)]) === table)?.id ??
    'custom'
  )
}

/** The conversion table: a bar showing the ranges, an editable table, and the preset it is. */
function BandEditor({ scale }: { scale: GradingScale }) {
  const maxPointsId = useId()
  const queryClient = useQueryClient()
  const presets = useScalePresets().data?.items
  const [rows, setRows] = useState(() => toRows(scale.bands))
  const [removingBand, setRemovingBand] = useState<number | null>(null)
  const [maxPoints, setMaxPoints] = useState(String(scale.max_points))
  const [switching, setSwitching] = useState<ScalePreset | null>(null)
  const [confirming, setConfirming] = useState(false)
  const save = useMutation({
    ...gradingScaleUpdateMutation(),
    onError: toastError,
    onSuccess: async (saved) => {
      // Unsaved edits go too: the saved table can equal the old one, which keeps this mounted.
      setRows(toRows(saved.bands))
      setMaxPoints(String(saved.max_points))
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
  const presetId = presetOf(presets, rows, maxPoints)

  return (
    <SettingsBlock title={m.grading_scale()} description={m.grading_scale_hint()}>
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
                    onClick={() => setRemovingBand(i)}
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
        <ChoiceControl
          label={m.grading_preset()}
          options={presetOptions(presets?.map((p) => p.id) ?? [presetId])}
          value={presetId}
          onChange={(id) => {
            setSwitching(presets?.find((p) => p.id === id) ?? null)
            setConfirming(true)
          }}
          disabled={save.isPending}
          selectClassName="w-52"
        />
      </div>
      <ConfirmDialog
        open={removingBand !== null}
        onOpenChange={(open) => !open && setRemovingBand(null)}
        title={m.grading_band_remove()}
        description={m.grading_band_remove_confirm()}
        confirmLabel={m.grading_band_remove()}
        onConfirm={() => {
          setRows(rows.filter((_, index) => index !== removingBand))
          setRemovingBand(null)
        }}
      />
      <ConfirmDialog
        open={confirming && switching !== null}
        onOpenChange={setConfirming}
        title={m.grading_preset_switch_title({
          name: presetOptions(switching ? [switching.id] : [])[0]?.label ?? '',
        })}
        description={m.grading_preset_switch_confirm()}
        confirmLabel={m.grading_preset_switch()}
        pending={save.isPending}
        onConfirm={() =>
          switching &&
          save.mutate({
            path: { program_id: scale.program_id },
            body: { bands: switching.bands, max_points: switching.max_points },
          })
        }
      />
    </SettingsBlock>
  )
}

type TemplateHandlers = {
  edit: (key: string, patch: Partial<CategoryTemplate>) => void
  onRemove: (template: CategoryTemplate) => void
}

const TemplateContext = createContext<TemplateHandlers | null>(null)

function useTemplateHandlers(): TemplateHandlers {
  const handlers = use(TemplateContext)
  if (!handlers) throw new Error('Template cells render inside the default categories table')
  return handlers
}

type TemplateCellProps = CellContext<typeof settingsTableFeatures, CategoryTemplate>

const templateColumn = createColumnHelper<typeof settingsTableFeatures, CategoryTemplate>()
const templateColumns = templateColumn.columns([
  templateColumn.display({
    id: 'color',
    header: () => m.common_color(),
    cell: function TemplateColorCell({ row }: TemplateCellProps) {
      const { edit } = useTemplateHandlers()
      return (
        <CategoryColorSelect
          label={`${m.grading_category_color()}: ${row.original.name}`}
          value={row.original.color}
          onChange={(color) => edit(row.original.key, { color })}
        />
      )
    },
  }),
  templateColumn.display({
    id: 'name',
    header: () => m.common_name(),
    cell: function TemplateNameCell({ row }: TemplateCellProps) {
      const { edit } = useTemplateHandlers()
      return (
        <Input
          aria-label={m.grading_category_name()}
          value={row.original.name}
          maxLength={60}
          onChange={(event) => edit(row.original.key, { name: event.target.value })}
          className="h-8 w-full"
        />
      )
    },
  }),
  templateColumn.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: function TemplateActionsCell({ row }: TemplateCellProps) {
      const { onRemove } = useTemplateHandlers()
      return (
        <RowMenu label={m.grading_category_actions({ name: row.original.name })}>
          <MoveMenuItems id={row.original.key} />
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onRemove(row.original)}>
            <Trash2 aria-hidden />
            {m.grading_category_remove()}
          </DropdownMenuItem>
        </RowMenu>
      )
    },
  }),
])

const TEMPLATE_COLUMN_CLASS: Record<string, string> = {
  color: 'w-20',
  name: 'w-full max-w-0',
  actions: 'w-10',
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
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<CategoryTemplate | null>(null)
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
    setAdding(false)
  }
  const handlers: TemplateHandlers = {
    edit: (key, patch) => apply(items.map((t) => (t.key === key ? { ...t, ...patch } : t))),
    onRemove: setRemoving,
  }
  return (
    <SettingsBlock
      title={m.grading_default_categories()}
      description={m.grading_default_categories_hint()}
    >
      <TemplateContext value={handlers}>
        <SettingsTable
          label={m.grading_default_categories()}
          data={items}
          columns={templateColumns}
          getRowId={(t) => t.key}
          columnClassName={TEMPLATE_COLUMN_CLASS}
          onReorder={async (keys) =>
            apply(keys.flatMap((key) => items.filter((t) => t.key === key)))
          }
          rowName={(t) => t.name}
          footer={
            adding ? (
              <form
                className="flex items-center gap-2 px-4 py-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  add()
                }}
              >
                <Input
                  aria-label={m.grading_category_new()}
                  placeholder={m.grading_category_new()}
                  value={draft}
                  maxLength={60}
                  ref={focusOnMount}
                  onChange={(event) => setDraft(event.target.value)}
                  className="h-8 flex-1"
                />
                <Button type="submit" size="sm" disabled={draft.trim() === ''}>
                  {m.grading_category_add()}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  {m.common_cancel()}
                </Button>
              </form>
            ) : (
              <ActionRow icon={Plus} onClick={() => setAdding(true)}>
                {m.grading_category_add()}
              </ActionRow>
            )
          }
        />
      </TemplateContext>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={m.grading_category_remove()}
        description={m.grading_default_category_remove_confirm({ name: removing?.name ?? '' })}
        confirmLabel={m.grading_category_remove()}
        onConfirm={() => {
          apply(items.filter((t) => t.key !== removing?.key))
          setRemoving(null)
        }}
      />
    </SettingsBlock>
  )
}
