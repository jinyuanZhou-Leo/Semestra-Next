import type { Provider } from '@semestra/api-client'
import {
  aiAssignmentUpdateMutation,
  aiProviderCreateMutation,
  aiStatusGetOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, ChevronRight, Waypoints } from 'lucide-react'
import { useId, useState, type ComponentType, type FormEvent } from 'react'
import { ChoiceControl } from '@/app/settings'
import { BrandLogo, BrandTile } from '@/components/BrandLogo'
import type { AiPurpose } from '@/hooks/use-ai-status'
import { errorMessage } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import {
  CAPABILITIES,
  CAPABILITY_TITLES,
  KIND_INFO,
  type Capability,
  type ProviderKind,
} from '../labels'
import { defaultRegion, hostOf, PRESETS, type ProviderPreset } from '../presets'
import { invalidateAi } from '../queries'

/** Chat-like purposes a typed default model is used for (compatible endpoints, Ollama). */
const MODEL_PURPOSES: readonly AiPurpose[] = ['chat', 'extraction', 'title']

/** The protocols offered for "another compatible endpoint". */
const CUSTOM_KINDS: readonly ProviderKind[] = [
  'openai_compatible',
  'openai_responses',
  'anthropic_compatible',
]

export function CapabilityChecks({
  value,
  onChange,
  disabled,
}: {
  value: readonly Capability[]
  onChange: (next: Capability[]) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <FieldSet disabled={disabled}>
      <FieldLegend variant="label">{m.ai_provider_capabilities()}</FieldLegend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {CAPABILITIES.map((capability) => (
          <Field key={capability} orientation="horizontal" className="w-auto">
            <Checkbox
              id={`${id}-${capability}`}
              checked={value.includes(capability)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? CAPABILITIES.filter((c) => c === capability || value.includes(c))
                    : value.filter((c) => c !== capability),
                )
              }
            />
            <FieldLabel htmlFor={`${id}-${capability}`} className="font-normal">
              {CAPABILITY_TITLES[capability]()}
            </FieldLabel>
          </Field>
        ))}
      </div>
    </FieldSet>
  )
}

/** A provider's mark; a generic icon for endpoints we don't recognise. */
export function ProviderMark({ logo, className }: { logo: string | null; className?: string }) {
  return logo ? (
    <BrandLogo src={logo} className={className} />
  ) : (
    <Waypoints aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} />
  )
}

/** A provider's mark in a small rounded tile. */
export function LogoTile({ logo }: { logo: string | null }) {
  return (
    <BrandTile>
      <ProviderMark logo={logo} />
    </BrandTile>
  )
}

/** Step one of adding a provider: the services we know, then "another compatible endpoint". */
function PresetPicker({ onPick }: { onPick: (preset: ProviderPreset) => void }) {
  return (
    <ItemGroup className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', SCROLL_BODY)}>
      {PRESETS.map((preset) => (
        <Item
          key={preset.id}
          variant="outline"
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Item's children label it
          render={<button type="button" />}
          size="sm"
          className="cursor-pointer flex-col items-start justify-start gap-3 text-left hover:bg-muted"
          onClick={() => onPick(preset)}
        >
          <ItemMedia>
            <ProviderMark logo={preset.logo} className="size-6" />
          </ItemMedia>
          <ItemContent className="w-full gap-0.5">
            <ItemTitle>{preset.name()}</ItemTitle>
            <ItemDescription className="text-xs">{preset.note()}</ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}

// The scrolling body of the add dialog (shadcn's "Scrollable Content" pattern): it reaches the
// dialog's edges so the scrollbar sits at the side, and keeps room for focus rings.
const SCROLL_BODY = 'w-auto -mx-6 -my-1 min-h-0 overflow-y-auto px-6 py-1'

export type FlowHeader = { title: string; description: string; logo?: string | null }

/**
 * "Add provider" (M06 §7): pick a service, then enter its key. `Header` draws the step's title
 * (a dialog header, or a heading in onboarding), so the title follows the step.
 */
export function AddProviderFlow({
  onSaved,
  submitLabel,
  Header,
}: {
  onSaved: (provider: Provider) => void
  submitLabel?: string
  Header: ComponentType<FlowHeader>
}) {
  const [preset, setPreset] = useState<ProviderPreset | null>(null)
  if (!preset) {
    return (
      <>
        <Header title={m.ai_provider_add()} description={m.ai_provider_pick()} />
        <PresetPicker onPick={setPreset} />
      </>
    )
  }
  return (
    <>
      <Header
        title={m.ai_provider_connect({ name: preset.name() })}
        description={m.ai_provider_save_note()}
        logo={preset.logo}
      />
      <ProviderForm
        key={preset.id}
        preset={preset}
        submitLabel={submitLabel}
        onSaved={onSaved}
        onBack={() => setPreset(null)}
      />
    </>
  )
}

/**
 * Step two: the key (and, for endpoints, the address, model and capabilities), then "Check and
 * save". The server verifies the key before storing it, so saving is the only confirmation.
 */
function ProviderForm({
  preset,
  onSaved,
  onBack,
  submitLabel,
}: {
  preset: ProviderPreset
  onSaved: (provider: Provider) => void
  onBack: () => void
  submitLabel?: string
}) {
  const queryClient = useQueryClient()
  const id = useId()
  const [kind, setKind] = useState<ProviderKind>(preset.kind ?? 'openai_compatible')
  const [name, setName] = useState('')
  const [region, setRegion] = useState(() => defaultRegion(preset, getLocale()))
  const [baseUrl, setBaseUrl] = useState(region?.baseUrl ?? preset.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [capabilities, setCapabilities] = useState<Capability[]>([
    ...KIND_INFO[kind].defaultCapabilities,
  ])
  const [model, setModel] = useState(preset.model ?? '')
  const create = useMutation(aiProviderCreateMutation())
  const assign = useMutation(aiAssignmentUpdateMutation())
  const info = KIND_INFO[kind]
  const keyUrl = region?.keyUrl ?? preset.keyUrl
  // A hosted service always needs a key; a self-run endpoint may not.
  const needsKey = info.needsKey || keyUrl !== undefined
  // A known service has its address filled in, so its details start folded away.
  const folded = preset.kind !== null && preset.kind !== 'ollama' && info.needsBaseUrl

  const chooseRegion = (value: string) => {
    const next = preset.regions?.find((r) => r.id === value)
    if (!next) return
    setRegion(next)
    setBaseUrl(next.baseUrl)
    create.reset()
  }

  const chooseKind = (next: ProviderKind) => {
    setKind(next)
    setCapabilities([...KIND_INFO[next].defaultCapabilities])
    create.reset()
  }

  const missing = (needsKey && !apiKey.trim()) || (info.needsBaseUrl && !baseUrl.trim())
  const pending = create.isPending || assign.isPending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (missing || pending) return
    let provider: Provider
    const body = {
      kind,
      // Named after the service ("DeepSeek"), not the protocol, unless the user names it.
      display_name:
        name.trim() || (preset.kind === kind && info.needsBaseUrl ? preset.name() : null),
      base_url: info.needsBaseUrl ? baseUrl.trim() : null,
      api_key: apiKey.trim() || null,
      capabilities: info.chooseCapabilities ? capabilities : null,
    }
    try {
      provider = await create.mutateAsync({ body })
    } catch {
      return // shown below the form
    }
    // Endpoints without recommended models: use the typed model where nothing serves yet.
    if (info.chooseCapabilities && model.trim()) {
      const status = await queryClient.fetchQuery({ ...aiStatusGetOptions(), staleTime: 0 })
      const purposes = [
        ...MODEL_PURPOSES,
        ...(capabilities.includes('vision') ? (['vision', 'ocr'] as const) : []),
      ]
      for (const purpose of purposes) {
        const current = status.items.find((s) => s.purpose === purpose)
        if (current?.available) continue
        await assign
          .mutateAsync({ body: { purpose, provider_id: provider.id, model: model.trim() } })
          .catch(() => undefined)
      }
    }
    await invalidateAi(queryClient)
    setApiKey('')
    onSaved(provider)
  }

  const endpointFields = info.needsBaseUrl ? (
    <>
      {preset.kind === null ? (
        <Field>
          <FieldLabel id={`${id}-kind`}>{m.ai_provider_protocol()}</FieldLabel>
          <ChoiceControl
            labelId={`${id}-kind`}
            value={kind}
            onChange={chooseKind}
            selectClassName="w-full"
            options={CUSTOM_KINDS.map((k) => ({
              value: k,
              label: KIND_INFO[k].name(),
              hint: KIND_INFO[k].hint(),
            }))}
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor={`${id}-base-url`}>{m.ai_provider_base_url()}</FieldLabel>
        <Input
          id={`${id}-base-url`}
          placeholder={info.baseUrlPlaceholder}
          value={baseUrl}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-model`}>{m.ai_provider_default_model()}</FieldLabel>
        <Input
          id={`${id}-model`}
          value={model}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={`${id}-model-hint`}
          onChange={(e) => setModel(e.target.value)}
        />
        <FieldDescription id={`${id}-model-hint`}>
          {m.ai_provider_default_model_hint()}
        </FieldDescription>
      </Field>
      <CapabilityChecks value={capabilities} onChange={setCapabilities} />
    </>
  ) : null

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-0 flex-col gap-6">
      <fieldset disabled={pending} className="contents">
        <FieldGroup className={SCROLL_BODY}>
          {folded ? null : endpointFields}
          {preset.regions && region ? (
            <Field>
              <FieldLabel id={`${id}-region`}>{m.ai_preset_region()}</FieldLabel>
              <ChoiceControl
                labelId={`${id}-region`}
                value={region.id}
                onChange={chooseRegion}
                options={preset.regions.map((r) => ({ value: r.id, label: r.label() }))}
              />
              <FieldDescription>{m.ai_preset_region_hint()}</FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`${id}-key`}>
              {needsKey ? m.ai_provider_api_key() : m.ai_provider_api_key_optional()}
            </FieldLabel>
            <Input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              ref={needsKey ? focusOnMount : undefined}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {keyUrl ? (
              <FieldDescription>
                <a
                  href={keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5"
                >
                  {m.ai_provider_create_key({ host: hostOf(keyUrl) })}
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </a>
              </FieldDescription>
            ) : null}
          </Field>
          {folded ? (
            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/trigger -ml-2 max-w-full justify-start font-normal aria-expanded:bg-transparent"
                  />
                }
              >
                <ChevronRight
                  aria-hidden
                  className="text-muted-foreground transition-transform group-data-panel-open/trigger:rotate-90"
                />
                <span className="font-medium">{m.ai_provider_endpoint_settings()}</span>
                <span className="truncate text-muted-foreground">
                  {[hostOf(baseUrl), model.trim()].filter(Boolean).join(' · ')}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
                {/* The left rule ties the fields to the trigger; padding keeps focus rings visible. */}
                <FieldGroup className="mt-3 ml-1.5 w-auto border-l-2 py-1 pr-1 pl-4">
                  {endpointFields}
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{m.ai_provider_name()}</FieldLabel>
            <Input
              id={`${id}-name`}
              placeholder={preset.kind === null ? info.name() : preset.name()}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <FieldError>{create.error ? errorMessage(create.error) : null}</FieldError>
        </FieldGroup>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            {m.ai_provider_back()}
          </Button>
          <Button type="submit" disabled={missing}>
            {pending ? m.ai_provider_checking() : (submitLabel ?? m.ai_provider_save())}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
