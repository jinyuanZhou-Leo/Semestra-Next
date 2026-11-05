import type {
  Assignment,
  LocalModels,
  ModelList,
  Provider,
  PurposeStatus,
} from '@semestra/api-client'
import {
  aiAssignmentGetOptions,
  aiAssignmentUpdateMutation,
  aiLocalModelDownloadMutation,
  aiProviderListModelsOptions,
  aiProviderListOptions,
  aiStatusGetOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Download, KeyRound, Plus } from 'lucide-react'
import { useState } from 'react'
import { SettingRow, SettingsGroup, SettingsNote, useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { JobProgress } from '@/components/JobProgress'
import type { AiPurpose } from '@/hooks/use-ai-status'
import { useJob } from '@/hooks/use-job'
import { formatBytes } from '@/lib/format'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from '@/ui/combobox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { ItemDescription } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import {
  LOCAL_MODELS,
  type LocalLevel,
  PROVIDER_ERROR_LABEL,
  PURPOSE_HINTS,
  PURPOSE_TITLES,
  canServe,
} from '../labels'
import { providerLogo } from '../presets'
import { invalidateAi } from '../queries'
import { ProviderMark } from './ProviderForm'

/** The models each enabled provider offers, by provider id. */
type ModelLists = ReadonlyMap<string, { data?: ModelList; isError: boolean }>

/** One choice in a task's model box: "Auto", a model of one provider, or one this server runs. */
type ModelOption = {
  key: string
  /** Null for "Auto" and for local models. */
  providerId: string | null
  /** A model this self-hosted server runs itself (OCR, embedding). */
  local?: boolean
  model: string
  label: string
  /** The model's id under its name, when the two differ. */
  detail: string | null
  /** Lower-case text the search matches: name, id and provider. */
  search: string
  /** The name typed into the search box, for endpoints that list no models. */
  typed?: boolean
  /** Download size, speed and accuracy of a local preset. */
  info?: (typeof LOCAL_MODELS)[string]
}

type ModelGroup = {
  id: string
  label: string
  logo: string | null
  items: ModelOption[]
}

const AUTO_KEY = 'auto'
const LOCAL_KEY = 'local'

/** A Hugging Face repository name, which a server that allows it can run as a local model. */
const HF_REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/

function localGroupLabel(purpose: AiPurpose): string {
  return purpose === 'ocr' ? m.ai_models_local_group() : m.ai_models_local_group_embedding()
}

function localOption(purpose: AiPurpose, model: string): ModelOption {
  return {
    key: `${LOCAL_KEY}/${model}`,
    providerId: null,
    local: true,
    model,
    label: model,
    detail: null,
    info: LOCAL_MODELS[model],
    search: `${model} ${purpose === 'ocr' ? 'paddleocr' : 'hugging face'}`.toLowerCase(),
  }
}

function modelOption(provider: Provider, model: string, name?: string | null): ModelOption {
  return {
    key: `${provider.id}/${model}`,
    providerId: provider.id,
    model,
    label: name || model,
    detail: name && name !== model ? model : null,
    search: `${name ?? ''} ${model} ${provider.display_name}`.toLowerCase(),
  }
}

/** A model's name as its provider lists it, or its id when the list does not have it. */
function modelName(lists: ModelLists, providerId: string | null, model: string | null): string {
  if (!providerId || !model) return model ?? ''
  const listed = lists.get(providerId)?.data?.items.find((item) => item.id === model)
  return listed?.display_name || model
}

/** Three short segments, so local models compare at a glance. */
function Level({ label, level }: { label: string; level: LocalLevel }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="sr-only">{m.ai_models_local_level({ label, level })}</span>
      <span aria-hidden>{label}</span>
      <span aria-hidden className="inline-flex gap-0.5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={
              n <= level ? 'h-1 w-3.5 rounded-full bg-primary' : 'h-1 w-3.5 rounded-full bg-muted'
            }
          />
        ))}
      </span>
    </span>
  )
}

/**
 * A local model that is not on this server yet: a button to fetch it (it also downloads the
 * first time it is needed), its download's progress, or why the download failed.
 */
function LocalModelDownload({
  purpose,
  model,
  downloaded,
  downloading,
  jobId,
}: {
  purpose: 'ocr' | 'embedding'
  model: string
  downloaded: boolean
  /** Downloading for someone else, e.g. inside a file's processing. */
  downloading: boolean
  jobId: string | null
}) {
  const queryClient = useQueryClient()
  const { status } = useJob(jobId)
  const start = useMutation({
    ...aiLocalModelDownloadMutation(),
    onSuccess: () => invalidateAi(queryClient),
    onError: toastError,
  })
  const failed = status === 'failed' || status === 'cancelled'
  const button = (
    <Button
      variant="outline"
      size="xs"
      disabled={start.isPending}
      onClick={() => start.mutate({ body: { purpose, model } })}
    >
      {failed ? null : <Download data-icon="inline-start" />}
      {failed ? m.ai_models_local_retry() : m.ai_models_local_download()}
    </Button>
  )
  if (jobId && failed) {
    return (
      <ItemDescription className="flex flex-wrap items-center gap-2 text-destructive">
        {m.ai_models_local_download_failed()}
        {button}
      </ItemDescription>
    )
  }
  if (jobId && status !== 'succeeded') return <JobProgress jobId={jobId} variant="compact" />
  if (downloaded) return null
  if (downloading) {
    return (
      <ItemDescription className="flex items-center gap-1.5">
        <Spinner className="size-3.5" />
        {m.ai_models_local_downloading()}
      </ItemDescription>
    )
  }
  return (
    <ItemDescription className="flex flex-wrap items-center gap-2">
      {m.ai_models_local_missing()}
      {button}
    </ItemDescription>
  )
}

/** The problem with the provider a task is using right now, if it has one. */
function ProviderProblem({ provider }: { provider: Provider | undefined }) {
  const code = provider?.last_error_code
  if (!provider || !code) return null
  return (
    <ItemDescription className="flex items-center gap-1.5 text-destructive">
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      {m.ai_models_provider_problem({
        name: provider.display_name,
        problem: PROVIDER_ERROR_LABEL[code]?.() ?? m.ai_provider_status_error(),
      })}
    </ItemDescription>
  )
}

function PurposeRow({
  assignment,
  providers,
  lists,
  status,
  local,
}: {
  assignment: Assignment
  providers: readonly Provider[]
  lists: ModelLists
  status: PurposeStatus | undefined
  /** The models a self-hosted server runs itself for this purpose, if it has any. */
  local: LocalModels | null
}) {
  const queryClient = useQueryClient()
  const purpose = assignment.purpose as AiPurpose
  const title = PURPOSE_TITLES[purpose]()
  const [query, setQuery] = useState('')
  const update = useMutation({
    ...aiAssignmentUpdateMutation(),
    onSuccess: () => invalidateAi(queryClient),
    onError: toastError,
  })
  const providerOf = (id: string | null | undefined) => providers.find((p) => p.id === id)

  // "Auto" follows the recommendation, which may change as providers come and go.
  const recommended = assignment.recommended
  // Local OCR comes first; local embedding only when no provider or instance model embeds.
  const autoLocal =
    local && (purpose !== 'embedding' || (!recommended && status?.source !== 'instance'))
  const autoWhere = autoLocal
    ? `${localGroupLabel(purpose)} · ${local.default}`
    : recommended
      ? `${providerOf(recommended.provider_id)?.display_name ?? ''} · ${modelName(lists, recommended.provider_id, recommended.model)}`
      : null
  const auto: ModelOption = {
    key: AUTO_KEY,
    providerId: null,
    model: '',
    label: m.ai_models_auto_option(),
    detail: autoWhere
      ? m.ai_models_auto_now({ where: autoWhere })
      : status?.source === 'instance'
        ? m.ai_models_using_instance({ model: status.model ?? '' })
        : m.ai_models_auto_none(),
    search: m.ai_models_auto_option().toLowerCase(),
  }

  const typed = query.trim()
  const groups: ModelGroup[] = providers
    .filter((p) => canServe(p, purpose))
    .map((provider) => {
      const list = lists.get(provider.id)
      const items = (list?.data?.items ?? []).map((item) =>
        modelOption(provider, item.id, item.display_name),
      )
      // Keep a saved model the provider no longer lists, so the box can still show it.
      if (
        assignment.provider_id === provider.id &&
        assignment.model &&
        !items.some((item) => item.model === assignment.model)
      ) {
        items.unshift(modelOption(provider, assignment.model))
      }
      // Endpoints that list no models take the name typed into the search box.
      const manual = list?.isError || list?.data?.manual_entry || list?.data?.items.length === 0
      if (manual && typed && !items.some((item) => item.model === typed)) {
        items.push({
          ...modelOption(provider, typed),
          label: m.ai_models_use_typed({ model: typed }),
          typed: true,
        })
      }
      return {
        id: provider.id,
        label: provider.display_name,
        logo: providerLogo(provider),
        items,
      }
    })
    .filter((group) => group.items.length > 0)
  if (local) {
    const items = local.models.map((model) => localOption(purpose, model))
    // A server that allows it runs any Hugging Face model with an ONNX version: typed by name.
    if (local.custom && HF_REPO.test(typed) && !items.some((item) => item.model === typed)) {
      items.push({
        ...localOption(purpose, typed),
        label: m.ai_models_local_use_hf({ model: typed }),
        typed: true,
      })
    }
    groups.unshift({ id: LOCAL_KEY, label: localGroupLabel(purpose), logo: null, items })
  }
  const all = [{ id: AUTO_KEY, label: '', logo: null, items: [auto] }, ...groups]
  const anyManual =
    local?.custom === true ||
    groups.some((group) => group.items.some((item) => item.typed)) ||
    providers.some((p) => canServe(p, purpose) && lists.get(p.id)?.data?.manual_entry)

  const selectedKey = assignment.provider_id
    ? `${assignment.provider_id}/${assignment.model}`
    : assignment.model
      ? `${LOCAL_KEY}/${assignment.model}`
      : null
  const selected =
    (selectedKey &&
      groups.flatMap((group) => group.items).find((item) => item.key === selectedKey)) ||
    auto
  const chosen = selected.key !== AUTO_KEY

  // What the box shows: the chosen model, or the one "Auto" resolves to now.
  const shownProvider = providerOf(selected.providerId ?? status?.provider_id)
  const shownLogo = shownProvider
    ? providerLogo(shownProvider)
    : status?.provider_kind
      ? providerLogo({ kind: status.provider_kind, base_url: null })
      : null
  const shownLabel = chosen
    ? selected.label
    : status?.available
      ? modelName(lists, status.provider_id, status.model)
      : null

  const pick = (next: ModelOption | null) => {
    setQuery('')
    if (!next || next.key === selected.key) return
    update.mutate({
      body: next.providerId
        ? { purpose, provider_id: next.providerId, model: next.model }
        : next.local
          ? { purpose, provider_id: null, model: next.model }
          : { purpose, provider_id: null },
    })
  }

  return (
    <SettingRow
      label={title}
      description={PURPOSE_HINTS[purpose]()}
      note={
        // Nothing until the status arrives, so no row flashes "Unavailable" on first load.
        status === undefined ? null : !status.available ? (
          <ItemDescription>{m.ai_models_unavailable()}</ItemDescription>
        ) : status.source === 'local' && status.model && local ? (
          <LocalModelDownload
            purpose={local.purpose}
            model={status.model}
            downloaded={local.downloaded.includes(status.model)}
            downloading={local.downloading.includes(status.model)}
            jobId={local.download_job ?? null}
          />
        ) : (
          <ProviderProblem provider={providerOf(status.provider_id)} />
        )
      }
    >
      <Combobox
        items={all}
        value={selected}
        onValueChange={pick}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(item: ModelOption) => item.label}
        isItemEqualToValue={(a: ModelOption, b: ModelOption) => a.key === b.key}
        filter={(item: ModelOption, text: string) =>
          item.typed === true || item.search.includes(text.trim().toLowerCase())
        }
        disabled={update.isPending}
      >
        <ComboboxTrigger
          aria-label={m.ai_models_aria({ purpose: title })}
          render={
            <Button variant="outline" className="w-full justify-between font-normal sm:w-72" />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            {shownLabel ? <ProviderMark logo={shownLogo} /> : null}
            {shownLabel === null && status === undefined ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span className={shownLabel ? 'truncate' : 'truncate text-muted-foreground'}>
                {shownLabel ?? m.ai_models_none()}
              </span>
            )}
            {chosen ? null : (
              <Badge variant="secondary" className="shrink-0">
                {m.ai_models_auto()}
              </Badge>
            )}
          </span>
        </ComboboxTrigger>
        <ComboboxContent className="w-80">
          <ComboboxInput
            showTrigger={false}
            placeholder={anyManual ? m.ai_models_search_or_type() : m.ai_models_search()}
          />
          <ComboboxEmpty>{m.ai_models_empty()}</ComboboxEmpty>
          <ComboboxList>
            {(group: (typeof all)[number]) => (
              <ComboboxGroup key={group.id} items={group.items}>
                {group.id === AUTO_KEY ? null : (
                  <>
                    <ComboboxSeparator />
                    <ComboboxLabel className="flex items-center gap-2">
                      <ProviderMark logo={group.logo} className="size-3.5" />
                      {group.label}
                    </ComboboxLabel>
                  </>
                )}
                <ComboboxCollection>
                  {(item: ModelOption) => (
                    <ComboboxItem key={item.key} value={item}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate">{item.label}</span>
                          {item.info ? (
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              {formatBytes(item.info.bytes)}
                            </span>
                          ) : null}
                        </span>
                        {item.info ? (
                          <span className="flex gap-4 text-xs text-muted-foreground">
                            <Level label={m.ai_models_local_speed()} level={item.info.speed} />
                            <Level
                              label={m.ai_models_local_accuracy()}
                              level={item.info.accuracy}
                            />
                          </span>
                        ) : null}
                        {item.detail ? (
                          <span
                            className={
                              item.providerId && !item.local
                                ? 'truncate font-mono text-xs text-muted-foreground'
                                : 'truncate text-xs text-muted-foreground'
                            }
                          >
                            {item.detail}
                          </span>
                        ) : null}
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </SettingRow>
  )
}

/** No provider at all: one empty state that leads to adding one. */
function NoProviders() {
  const settings = useSettingsDialog()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRound aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{m.ai_providers_empty()}</EmptyTitle>
        <EmptyDescription>{m.ai_models_empty_description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          size="sm"
          onClick={() =>
            settings.open({ level: 'account', group: 'ai-providers', section: 'ai-providers' })
          }
        >
          <Plus aria-hidden />
          {m.ai_provider_add()}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/** Account settings → AI → models (M06 §7): one searchable box per task, "Auto" first. */
export function ModelsSection() {
  const assignments = useQuery(aiAssignmentGetOptions())
  const providers = useQuery(aiProviderListOptions())
  const status = useQuery({
    ...aiStatusGetOptions(),
    // Only the user whose job it is hears that a download finished: poll while one runs.
    refetchInterval: (query) =>
      query.state.data?.local?.some((entry) => entry.downloading.length) ? 3000 : false,
  })
  const enabled = (providers.data?.items ?? []).filter((p) => p.enabled)
  // Shared by every task's box; the server caches each provider's list.
  const results = useQueries({
    queries: enabled.map((p) => ({
      ...aiProviderListModelsOptions({ path: { id: p.id } }),
      retry: false,
    })),
  })
  const lists: ModelLists = new Map(
    enabled.flatMap((p, i) => (results[i] ? [[p.id, results[i]] as const] : [])),
  )
  // Models this server runs itself count: their rows stay visible with no provider.
  const noProviders =
    providers.data?.items.length === 0 &&
    !status.data?.items.some((item) => item.source === 'instance') &&
    !status.data?.local?.length
  if (noProviders) return <NoProviders />

  return (
    <AsyncBoundary query={assignments}>
      {(data) => (
        <div className="space-y-3">
          <SettingsGroup>
            {data.items.map((assignment) => {
              const purposeStatus = status.data?.items.find((s) => s.purpose === assignment.purpose)
              return (
                <PurposeRow
                  key={assignment.purpose}
                  assignment={assignment}
                  providers={providers.data?.items ?? []}
                  lists={lists}
                  status={purposeStatus}
                  local={
                    status.data?.local?.find((entry) => entry.purpose === assignment.purpose) ??
                    null
                  }
                />
              )
            })}
          </SettingsGroup>
          <SettingsNote>{m.ai_models_intro()}</SettingsNote>
        </div>
      )}
    </AsyncBoundary>
  )
}
