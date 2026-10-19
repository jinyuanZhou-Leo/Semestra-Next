import type { AssessmentCategory, Gradebook } from '@semestra/api-client'
import {
  gradingCategoryCreateMutation,
  gradingCategoryDeleteMutation,
  gradingCategoryReorderMutation,
  gradingCategoryUpdateMutation,
  gradingCourseResultUpdateMutation,
} from '@semestra/api-client/react-query'
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
  SettingsNote,
  SettingsTable,
  settingsTableFeatures,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Input } from '@/ui/input'
import { Switch } from '@/ui/switch'
import { CategoryColorSelect } from '../components/CategoryColorSelect'
import { categoryName } from '../display'
import { invalidateGrading, useGradebook } from '../queries'

/** Course "Grades" settings (M03 §5.1): how it is graded, the forecast model, categories. */
export function CourseGradingSection({ scope }: SettingsSectionProps) {
  const courseId = scope?.kind === 'course' ? scope.courseId : ''
  return (
    <AsyncBoundary query={useGradebook(courseId)}>
      {(gradebook) => <CourseGrading gradebook={gradebook} />}
    </AsyncBoundary>
  )
}

function CourseGrading({ gradebook }: { gradebook: Gradebook }) {
  const queryClient = useQueryClient()
  const { result } = gradebook
  const basisId = useId()
  const enabledId = useId()
  const forecastId = useId()
  const update = useMutation({
    ...gradingCourseResultUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const patch = (body: Parameters<typeof update.mutate>[0]['body']) =>
    update.mutate({ path: { course_id: gradebook.course_id }, body })
  const forecastItems = [
    { value: 'auto', label: m.grading_forecast_auto(), hint: m.grading_forecast_auto_hint() },
    {
      value: 'simple_minimum_needed',
      label: m.grading_forecast_simple(),
      hint: m.grading_forecast_simple_hint(),
    },
  ] as const
  const basisItems = [
    {
      value: 'percentage',
      label: m.grading_basis_percentage(),
      hint: m.grading_basis_percentage_hint(),
    },
    {
      value: 'pass_fail',
      label: m.grading_basis_pass_fail(),
      hint: m.grading_basis_pass_fail_hint(),
    },
  ] as const
  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingRow
          label={m.grading_basis()}
          labelId={basisId}
          description={m.grading_basis_hint()}
        >
          <ChoiceControl
            labelId={basisId}
            options={basisItems}
            value={result.basis}
            onChange={(basis) => patch({ basis })}
          />
        </SettingRow>
        {result.basis === 'percentage'
          ? // An array, not a fragment, so the group still puts a hairline between the rows.
            [
              <SettingRow
                key="enabled"
                label={m.grading_gradebook_enabled()}
                labelId={enabledId}
                description={m.grading_gradebook_enabled_hint()}
              >
                <Switch
                  aria-labelledby={enabledId}
                  checked={result.gradebook_enabled}
                  onCheckedChange={(on) => patch({ gradebook_enabled: on })}
                />
              </SettingRow>,
              <SettingRow
                key="forecast"
                label={m.grading_forecast_model()}
                labelId={forecastId}
                description={m.grading_forecast_model_hint()}
              >
                <ChoiceControl
                  labelId={forecastId}
                  options={forecastItems}
                  value={result.forecast_model}
                  onChange={(forecast_model) => patch({ forecast_model })}
                />
              </SettingRow>,
            ]
          : null}
      </SettingsGroup>
      <Categories gradebook={gradebook} />
    </div>
  )
}

type CategoryHandlers = {
  update: (
    category: AssessmentCategory,
    body: { name?: string; color?: string; archived?: boolean },
  ) => void
  onRemove: (category: AssessmentCategory) => void
}

const CategoryContext = createContext<CategoryHandlers | null>(null)

function useCategoryHandlers(): CategoryHandlers {
  const handlers = use(CategoryContext)
  if (!handlers) throw new Error('Category cells render inside the categories table')
  return handlers
}

type CategoryCellProps = CellContext<typeof settingsTableFeatures, AssessmentCategory>

function CategoryColorCell({ row }: CategoryCellProps) {
  const { update } = useCategoryHandlers()
  const category = row.original
  return (
    <CategoryColorSelect
      label={`${m.grading_category_color()}: ${categoryName(category)}`}
      value={category.color}
      onChange={(color) => update(category, { color })}
    />
  )
}

function CategoryNameCell({ row }: CategoryCellProps) {
  const { update } = useCategoryHandlers()
  const category = row.original
  return (
    <Input
      key={`${category.id}-${category.name}`}
      aria-label={m.grading_category_name()}
      defaultValue={categoryName(category)}
      maxLength={60}
      onBlur={(event) => {
        const name = event.target.value.trim()
        if (name !== '' && name !== categoryName(category)) update(category, { name })
      }}
      className={cn('h-8 w-full', category.archived && 'text-muted-foreground')}
    />
  )
}

function CategoryActiveCell({ row }: CategoryCellProps) {
  const { update } = useCategoryHandlers()
  const category = row.original
  return (
    <Switch
      aria-label={`${m.grading_category_active()}: ${categoryName(category)}`}
      checked={!category.archived}
      onCheckedChange={(active) => update(category, { archived: !active })}
    />
  )
}

function CategoryActionsCell({ row }: CategoryCellProps) {
  const { onRemove } = useCategoryHandlers()
  const category = row.original
  return (
    <RowMenu label={m.grading_category_actions({ name: categoryName(category) })}>
      <MoveMenuItems id={category.id} />
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onRemove(category)}>
        <Trash2 aria-hidden />
        {m.grading_category_remove()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const categoryColumn = createColumnHelper<typeof settingsTableFeatures, AssessmentCategory>()
const categoryColumns = categoryColumn.columns([
  categoryColumn.display({
    id: 'color',
    header: () => m.common_color(),
    cell: CategoryColorCell,
  }),
  categoryColumn.display({
    id: 'name',
    header: () => m.common_name(),
    cell: CategoryNameCell,
  }),
  categoryColumn.display({
    id: 'active',
    header: () => m.grading_category_active(),
    cell: CategoryActiveCell,
  }),
  categoryColumn.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: CategoryActionsCell,
  }),
])

const CATEGORY_COLUMN_CLASS: Record<string, string> = {
  color: 'w-16',
  name: 'w-full max-w-0',
  active: 'w-16 whitespace-nowrap',
  actions: 'w-10',
}

function Categories({ gradebook }: { gradebook: Gradebook }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<AssessmentCategory | null>(null)
  const refresh = () => invalidateGrading(queryClient)
  const create = useMutation({
    ...gradingCategoryCreateMutation(),
    onError: toastError,
    onSuccess: async () => {
      setDraft('')
      setAdding(false)
      await refresh()
    },
  })
  const update = useMutation({
    ...gradingCategoryUpdateMutation(),
    onError: toastError,
    onSuccess: refresh,
  })
  const reorder = useMutation({
    ...gradingCategoryReorderMutation(),
    onError: toastError,
    onSettled: refresh,
  })
  const remove = useMutation({
    ...gradingCategoryDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      setRemoving(null)
      await refresh()
    },
  })
  const categories = gradebook.categories.toSorted((a, b) => a.position - b.position)
  const handlers: CategoryHandlers = {
    update: (category, body) => update.mutate({ path: { category_id: category.id }, body }),
    onRemove: setRemoving,
  }
  return (
    <SettingsBlock title={m.grading_categories()} description={m.grading_categories_hint()}>
      <CategoryContext value={handlers}>
        <SettingsTable
          label={m.grading_categories()}
          data={categories}
          columns={categoryColumns}
          getRowId={(c) => c.id}
          columnClassName={CATEGORY_COLUMN_CLASS}
          onReorder={(ids) =>
            reorder.mutateAsync({
              path: { course_id: gradebook.course_id },
              body: { category_ids: ids },
            })
          }
          rowName={categoryName}
          footer={
            adding ? (
              <form
                className="flex items-center gap-2 px-4 py-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  const name = draft.trim()
                  if (name !== '') {
                    create.mutate({ path: { course_id: gradebook.course_id }, body: { name } })
                  }
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
                <Button type="submit" size="sm" disabled={draft.trim() === '' || create.isPending}>
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
      </CategoryContext>
      <SettingsNote>{m.grading_category_active_hint()}</SettingsNote>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={m.grading_category_remove()}
        description={m.grading_category_remove_confirm({
          name: removing ? categoryName(removing) : '',
        })}
        confirmLabel={m.grading_category_remove()}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate({ path: { category_id: removing.id } })}
      />
    </SettingsBlock>
  )
}
