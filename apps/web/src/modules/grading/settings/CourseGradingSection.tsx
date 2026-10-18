import type { AssessmentCategory, Gradebook } from '@semestra/api-client'
import {
  gradingCategoryCreateMutation,
  gradingCategoryDeleteMutation,
  gradingCategoryReorderMutation,
  gradingCategoryUpdateMutation,
  gradingCourseResultUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
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
import { CategoryColorSelect } from '../components/CategoryColorSelect'
import { categoryName } from '../display'
import { invalidateGrading, useGradebook } from '../queries'
import { SettingRow } from './rows'

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
    { value: 'auto', label: m.grading_forecast_auto() },
    { value: 'simple_minimum_needed', label: m.grading_forecast_simple() },
  ]
  return (
    <div className="space-y-6">
      <ItemGroup className="gap-0 divide-y divide-border rounded-2xl border">
        <SettingRow
          label={m.grading_basis()}
          labelId={basisId}
          description={m.grading_basis_hint()}
        >
          <ToggleGroup
            aria-labelledby={basisId}
            variant="outline"
            size="sm"
            value={[result.basis]}
            onValueChange={([basis]) => {
              if (basis) patch({ basis: basis === 'pass_fail' ? 'pass_fail' : 'percentage' })
            }}
          >
            <ToggleGroupItem value="percentage">{m.grading_basis_percentage()}</ToggleGroupItem>
            <ToggleGroupItem value="pass_fail">{m.grading_basis_pass_fail()}</ToggleGroupItem>
          </ToggleGroup>
        </SettingRow>
        {result.basis === 'percentage' ? (
          <>
            <SettingRow
              label={m.grading_gradebook_enabled()}
              labelId={enabledId}
              description={m.grading_gradebook_enabled_hint()}
            >
              <Switch
                aria-labelledby={enabledId}
                checked={result.gradebook_enabled}
                onCheckedChange={(on) => patch({ gradebook_enabled: on })}
              />
            </SettingRow>
            <SettingRow
              label={m.grading_forecast_model()}
              labelId={forecastId}
              description={m.grading_forecast_model_hint()}
            >
              <Select
                value={result.forecast_model}
                items={forecastItems}
                onValueChange={(next) =>
                  patch({ forecast_model: next === 'simple_minimum_needed' ? next : 'auto' })
                }
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
          </>
        ) : null}
      </ItemGroup>
      <Categories gradebook={gradebook} />
    </div>
  )
}

function Categories({ gradebook }: { gradebook: Gradebook }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<AssessmentCategory | null>(null)
  const refresh = () => invalidateGrading(queryClient)
  const create = useMutation({
    ...gradingCategoryCreateMutation(),
    onError: toastError,
    onSuccess: async () => {
      setDraft('')
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
    onSuccess: refresh,
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
  const move = (index: number, by: -1 | 1) => {
    const ids = categories.map((c) => c.id)
    const target = index + by
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    reorder.mutate({ path: { course_id: gradebook.course_id }, body: { category_ids: ids } })
  }
  return (
    <section className="space-y-3" aria-label={m.grading_categories()}>
      <div>
        <h3 className="font-heading text-sm font-medium">{m.grading_categories()}</h3>
        <p className="text-xs text-muted-foreground">{m.grading_categories_hint()}</p>
      </div>
      <ItemGroup className="gap-0 divide-y divide-border rounded-2xl border">
        {categories.map((category, i) => (
          <Item key={category.id} size="sm">
            <Input
              key={`${category.id}-${category.name}`}
              aria-label={m.grading_category_name()}
              defaultValue={categoryName(category)}
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name !== '' && name !== categoryName(category)) {
                  update.mutate({ path: { category_id: category.id }, body: { name } })
                }
              }}
              className="h-8 max-w-60 flex-1"
            />
            <CategoryColorSelect
              label={m.grading_category_color()}
              value={category.color}
              onChange={(color) =>
                update.mutate({ path: { category_id: category.id }, body: { color } })
              }
            />
            <Field orientation="horizontal" className="w-auto">
              <Switch
                id={`${category.id}-archived`}
                aria-label={`${m.grading_category_archived()}: ${categoryName(category)}`}
                checked={category.archived}
                onCheckedChange={(archived) =>
                  update.mutate({ path: { category_id: category.id }, body: { archived } })
                }
              />
              <FieldLabel htmlFor={`${category.id}-archived`} className="font-normal">
                {m.grading_category_archived()}
              </FieldLabel>
            </Field>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${m.grading_move_up()}: ${categoryName(category)}`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${m.grading_move_down()}: ${categoryName(category)}`}
              disabled={i === categories.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${m.grading_category_remove()}: ${categoryName(category)}`}
              onClick={() => setRemoving(category)}
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
                const name = draft.trim()
                if (name !== '') {
                  create.mutate({ path: { course_id: gradebook.course_id }, body: { name } })
                }
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
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={draft.trim() === '' || create.isPending}
          >
            <Plus aria-hidden />
            {m.grading_category_add()}
          </Button>
        </Item>
      </ItemGroup>
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
    </section>
  )
}
