import type { Assignment, Provider, PurposeStatus } from '@semestra/api-client'
import {
  aiAssignmentGetOptions,
  aiAssignmentUpdateMutation,
  aiProviderListOptions,
  aiProviderModelsOptions,
  aiStatusOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useId, useState, type FormEvent } from 'react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import type { AiPurpose } from '@/hooks/use-ai-status'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { Input } from '@/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { PURPOSE_HINTS, PURPOSE_TITLES, canServe } from '../labels'
import { invalidateAi } from '../queries'

/** Select value for "no choice of my own: use the recommended default". */
const RECOMMENDED = '__recommended__'

function statusLine(status: PurposeStatus | undefined): string {
  if (!status?.available) return m.ai_models_unavailable()
  const where = `${status.provider_name ?? ''} · ${status.model ?? ''}`
  if (status.source === 'instance') return m.ai_models_using_instance({ model: status.model ?? '' })
  if (status.source === 'default') return m.ai_models_using_default({ where })
  return m.ai_models_using({ where })
}

function ModelPicker({
  providerId,
  value,
  labelId,
  disabled,
  onPick,
}: {
  providerId: string
  value: string | null
  labelId: string
  disabled: boolean
  onPick: (model: string) => void
}) {
  const models = useQuery(aiProviderModelsOptions({ path: { id: providerId } }))
  const [typed, setTyped] = useState(value ?? '')

  if (models.isPending) {
    return (
      <Input
        aria-labelledby={labelId}
        disabled
        placeholder={m.common_loading()}
        className="sm:w-64"
      />
    )
  }
  // The endpoint lists no models (or the list failed): the user types the name.
  if (models.isError || models.data.manual_entry || models.data.items.length === 0) {
    const submit = (e: FormEvent) => {
      e.preventDefault()
      if (typed.trim() && typed.trim() !== value) onPick(typed.trim())
    }
    return (
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-labelledby={labelId}
          value={typed}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder={m.ai_models_model_placeholder()}
          className="sm:w-64"
          onChange={(e) => setTyped(e.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || !typed.trim() || typed.trim() === value}
        >
          {m.common_save()}
        </Button>
      </form>
    )
  }

  const items = models.data.items.map((item) => ({
    value: item.id,
    label: item.display_name ?? item.id,
  }))
  // Keep a saved model that the provider no longer lists selectable, so the value stays visible.
  if (value && !items.some((item) => item.value === value)) items.unshift({ value, label: value })
  return (
    <Select
      value={value}
      items={items}
      disabled={disabled}
      onValueChange={(next) => next && next !== value && onPick(next)}
    >
      <SelectTrigger aria-labelledby={labelId} className="w-full sm:w-64">
        <SelectValue placeholder={m.ai_models_pick_model()} />
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
  )
}

function PurposeRow({
  assignment,
  providers,
  status,
}: {
  assignment: Assignment
  providers: readonly Provider[]
  status: PurposeStatus | undefined
}) {
  const queryClient = useQueryClient()
  const labelId = useId()
  const purpose = assignment.purpose as AiPurpose
  // A provider picked here but without a model yet; saved once a model is chosen.
  const [draftProvider, setDraftProvider] = useState<string | null>(null)
  const update = useMutation({
    ...aiAssignmentUpdateMutation(),
    onSuccess: async () => {
      setDraftProvider(null)
      await invalidateAi(queryClient)
    },
    onError: toastError,
  })

  const usable = providers.filter((p) => canServe(p, purpose))
  const recommendedName = providers.find(
    (p) => p.id === assignment.recommended?.provider_id,
  )?.display_name
  const providerId = draftProvider ?? assignment.provider_id
  const providerItems = [
    {
      value: RECOMMENDED,
      label: assignment.recommended
        ? m.ai_models_recommended({
            where: `${recommendedName ?? ''} · ${assignment.recommended.model}`,
          })
        : m.ai_models_recommended_none(),
    },
    ...usable.map((p) => ({ value: p.id, label: p.display_name })),
  ]

  const pickProvider = (next: string) => {
    if (next === RECOMMENDED) {
      setDraftProvider(null)
      if (assignment.provider_id) update.mutate({ body: { purpose, provider_id: null } })
      return
    }
    if (next === assignment.provider_id) return setDraftProvider(null)
    // The recommended model of that provider can be saved straight away.
    if (assignment.recommended?.provider_id === next) {
      update.mutate({ body: { purpose, provider_id: next, model: assignment.recommended.model } })
      return
    }
    setDraftProvider(next)
  }

  return (
    <Item>
      <ItemContent className="min-w-0 basis-64">
        <ItemTitle id={labelId}>{PURPOSE_TITLES[purpose]()}</ItemTitle>
        <ItemDescription>{PURPOSE_HINTS[purpose]()}</ItemDescription>
        <ItemDescription>{statusLine(status)}</ItemDescription>
      </ItemContent>
      <ItemActions className="w-full flex-col items-stretch sm:w-auto sm:items-end">
        <Select
          value={providerId ?? RECOMMENDED}
          items={providerItems}
          disabled={update.isPending}
          onValueChange={(next) => next && pickProvider(next)}
        >
          <SelectTrigger
            aria-label={m.ai_models_provider_aria({ purpose: PURPOSE_TITLES[purpose]() })}
            className="w-full sm:w-64"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {providerItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {providerId ? (
          <ModelPicker
            key={providerId}
            providerId={providerId}
            value={draftProvider ? null : assignment.model}
            labelId={labelId}
            disabled={update.isPending}
            onPick={(model) => update.mutate({ body: { purpose, provider_id: providerId, model } })}
          />
        ) : null}
      </ItemActions>
    </Item>
  )
}

/** Account settings → AI → models per purpose (M06 §7). */
export function ModelsSection() {
  const assignments = useQuery(aiAssignmentGetOptions())
  const providers = useQuery(aiProviderListOptions())
  const status = useQuery(aiStatusOptions())

  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{m.ai_models_intro()}</p>
        <AsyncBoundary query={assignments}>
          {(data) => (
            <ItemGroup className="gap-0 rounded-2xl border">
              {data.items.map((assignment, index) => (
                <Fragment key={assignment.purpose}>
                  {index > 0 ? <ItemSeparator className="my-0" /> : null}
                  <PurposeRow
                    assignment={assignment}
                    providers={providers.data?.items ?? []}
                    status={status.data?.items.find((s) => s.purpose === assignment.purpose)}
                  />
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </AsyncBoundary>
      </CardContent>
    </Card>
  )
}
