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
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { NewCategoryDialog } from './NewCategoryDialog'
import { Button } from '@/ui/button'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Switch } from '@/ui/switch'
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

/** A row of the conversion table with its position; rows are edited in place and have no id. */
type BandLine = { index: number; row: BandRow }
type BandField = keyof BandRow

const BandsContext = createContext<{
  edit: (index: number, patch: Partial<BandRow>) => void
  remove: (index: number) => void
} | null>(null)

function useBands() {
  const state = use(BandsContext)
  if (!state) throw new Error('band cells must render inside the conversion table')
  return state
}

const BAND_FIELDS: Record<BandField, { header: () => string }> = {
  min: { header: () => m.grading_band_min() },
  max: { header: () => m.grading_band_max() },
  points: { header: () => m.grading_band_points() },
  letter: { header: () => m.grading_band_letter() },
}

function BandInput({ line, field }: { line: BandLine; field: BandField }) {
  const { edit } = useBands()
  return (
    <Input
      aria-label={`${m.grading_band()} ${line.index + 1}: ${BAND_FIELDS[field].header()}`}
      inputMode={field === 'letter' ? 'text' : 'decimal'}
      value={line.row[field]}
      maxLength={field === 'letter' ? 8 : undefined}
      onChange={(event) => edit(line.index, { [field]: event.target.value })}
      className="h-8 w-24 tabular-nums"
    />
  )
}

function BandRemove({ line }: { line: BandLine }) {
  const { remove } = useBands()
  return (
    <Button
      variant="destructive"
      size="icon-sm"
      aria-label={`${m.grading_band_remove()} ${line.index + 1}`}
      onClick={() => remove(line.index)}
    >
      <Trash2 aria-hidden />
    </Button>
  )
}

const bandColumn = createColumnHelper<typeof settingsTableFeatures, BandLine>()
const bandColumns = bandColumn.columns([
  ...(Object.keys(BAND_FIELDS) as BandField[]).map((field) =>
    bandColumn.display({
      id: field,
      header: BAND_FIELDS[field].header,
      cell: ({ row }) => <BandInput line={row.original} field={field} />,
    }),
  ),
  bandColumn.display({
    id: 'remove',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ({ row }) => <BandRemove line={row.original} />,
  }),
])
const BAND_COLUMN_CLASS = { remove: 'w-14' }

/** Whether two tables convert the same, however their numbers were typed. */
const sameTable = (
  a: { bands: readonly ScaleBand[]; max_points: number },
  b: { bands: readonly ScaleBand[]; max_points: number },
): boolean => {
  const key = (t: typeof a) =>
    JSON.stringify([
      t.max_points,
      t.bands
        .toSorted((x, y) => x.min - y.min)
        .map((band) => [band.min, band.max, band.points, band.letter ?? null]),
    ])
  return key(a) === key(b)
}

/** The picker's value when the table matches no preset; shown, never picked. */
const MODIFIED = 'modified'

/** The conversion table: a bar showing the ranges, an editable table, and the preset it is. */
function BandEditor({ scale }: { scale: GradingScale }) {
  const maxPointsId = useId()
  const queryClient = useQueryClient()
  const presets = useScalePresets().data?.items
  const [rows, setRows] = useState(() => toRows(scale.bands))
  const removingBand = useDialogTarget<number>()
  const [maxPoints, setMaxPoints] = useState(String(scale.max_points))
  const [switching, setSwitching] = useState<ScalePreset | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [discardingEdits, setDiscardingEdits] = useState(false)
  const restoreSaved = () => {
    setRows(toRows(scale.bands))
    setMaxPoints(String(scale.max_points))
  }
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
  const table = { bands, max_points: Number(maxPoints) }
  // Unknown until the presets load, so the picker never shows a table that is not the one in use.
  const presetId = presets && (presets.find((p) => sameTable(p, table))?.id ?? MODIFIED)
  const discarding = switching !== null && sameTable(switching, scale)
  const switchingName = presetOptions(switching ? [switching.id] : [])[0]?.label ?? ''

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
      <BandsContext value={{ edit, remove: removingBand.show }}>
        <SettingsTable
          label={m.grading_scale()}
          data={rows.map((row, index) => ({ index, row }))}
          columns={bandColumns}
          getRowId={(line) => String(line.index)}
          columnClassName={BAND_COLUMN_CLASS}
        />
      </BandsContext>
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
        <Button
          variant="destructive"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => setDiscardingEdits(true)}
        >
          {m.grading_preset_discard()}
        </Button>
        <span className="flex-1" />
        <ChoiceControl
          label={m.grading_preset()}
          options={[
            ...presetOptions(presets?.map((p) => p.id) ?? []),
            ...(presetId === MODIFIED
              ? [
                  {
                    value: MODIFIED,
                    label: m.grading_preset_modified(),
                    hint: m.grading_preset_modified_hint(),
                    disabled: true,
                  },
                ]
              : []),
          ]}
          value={presetId ?? ''}
          onChange={(id) => {
            // The select can report the value it now shows after the table changes under it.
            if (id === presetId) return
            setSwitching(presets?.find((p) => p.id === id) ?? null)
            setConfirming(true)
          }}
          disabled={!presets || save.isPending}
          selectClassName="w-52"
        />
      </div>
      <ConfirmDialog
        {...removingBand.props}
        title={m.grading_band_remove()}
        description={m.grading_band_remove_confirm()}
        confirmLabel={m.grading_band_remove()}
        onConfirm={() => {
          setRows(rows.filter((_, index) => index !== removingBand.target))
          removingBand.close()
        }}
      />
      <ConfirmDialog
        open={confirming && switching !== null}
        onOpenChange={setConfirming}
        title={
          discarding
            ? m.grading_preset_discard_title()
            : m.grading_preset_switch_title({ name: switchingName })
        }
        description={
          discarding
            ? m.grading_preset_discard_confirm({ name: switchingName })
            : dirty
              ? `${m.grading_preset_switch_confirm()} ${m.grading_preset_switch_unsaved()}`
              : m.grading_preset_switch_confirm()
        }
        confirmLabel={discarding ? m.grading_preset_discard() : m.grading_preset_switch()}
        pending={save.isPending}
        onConfirm={() => {
          if (!switching) return
          if (discarding) {
            // The saved table already is this preset: only the edits go, nothing to save.
            restoreSaved()
            setConfirming(false)
            return
          }
          save.mutate({
            path: { program_id: scale.program_id },
            body: { bands: switching.bands, max_points: switching.max_points },
          })
        }}
      />
      <ConfirmDialog
        open={discardingEdits}
        onOpenChange={setDiscardingEdits}
        title={m.grading_preset_discard_title()}
        description={m.grading_preset_switch_unsaved()}
        confirmLabel={m.grading_preset_discard()}
        onConfirm={() => {
          restoreSaved()
          setDiscardingEdits(false)
        }}
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
  // A fresh dialog (empty name) each time it opens.
  const [addKey, setAddKey] = useState(0)
  const removing = useDialogTarget<CategoryTemplate>()
  const apply = (next: CategoryTemplate[]) => {
    setItems(next)
    if (next.every((t) => t.name.trim() !== '')) onChange(next)
  }
  const add = (name: string) => {
    const taken = new Set(items.map((t) => t.key))
    const base =
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-+|-+$/g, '') || 'category'
    let key = base.slice(0, 28)
    for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 26)}-${n}`
    apply([...items, { key, name, color: 'slate' }])
    setAdding(false)
  }
  const handlers: TemplateHandlers = {
    edit: (key, patch) => apply(items.map((t) => (t.key === key ? { ...t, ...patch } : t))),
    onRemove: removing.show,
  }
  return (
    <SettingsBlock
      title={m.grading_default_categories()}
      description={m.grading_default_categories_hint()}
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAddKey((k) => k + 1)
            setAdding(true)
          }}
        >
          <Plus aria-hidden />
          {m.grading_category_create()}
        </Button>
      }
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
        />
      </TemplateContext>
      <NewCategoryDialog key={addKey} open={adding} onOpenChange={setAdding} onSubmit={add} />
      <ConfirmDialog
        {...removing.props}
        title={m.grading_category_remove()}
        description={m.grading_default_category_remove_confirm({
          name: removing.target?.name ?? '',
        })}
        confirmLabel={m.grading_category_remove()}
        onConfirm={() => {
          apply(items.filter((t) => t.key !== removing.target?.key))
          removing.close()
        }}
      />
    </SettingsBlock>
  )
}
