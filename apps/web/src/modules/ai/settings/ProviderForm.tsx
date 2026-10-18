import type { Provider } from '@semestra/api-client'
import {
  aiAssignmentUpdateMutation,
  aiProviderCreateMutation,
  aiStatusOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { TextField } from '@/components/TextField'
import type { AiPurpose } from '@/hooks/use-ai-status'
import { errorMessage } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import {
  CAPABILITIES,
  CAPABILITY_TITLES,
  KIND_INFO,
  KINDS,
  type Capability,
  type ProviderKind,
} from '../labels'
import { invalidateAi } from '../queries'

/** Chat-like purposes a typed default model is used for (compatible endpoints, Ollama). */
const MODEL_PURPOSES: readonly AiPurpose[] = ['chat', 'extraction', 'title']

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
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{m.ai_provider_capabilities()}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {CAPABILITIES.map((capability) => (
          <label
            key={capability}
            htmlFor={`${id}-${capability}`}
            className="flex items-center gap-2 text-sm"
          >
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
            {CAPABILITY_TITLES[capability]()}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Pick a provider type, enter its key (and URL), then "Check and save" (M06 §7). The server
 * verifies the key before storing it, so saving is the only confirmation.
 */
export function ProviderForm({
  onSaved,
  submitLabel,
}: {
  onSaved: (provider: Provider) => void
  submitLabel?: string
}) {
  const queryClient = useQueryClient()
  const kindId = useId()
  const [kind, setKind] = useState<ProviderKind>('anthropic')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [model, setModel] = useState('')
  const create = useMutation(aiProviderCreateMutation())
  const assign = useMutation(aiAssignmentUpdateMutation())
  const info = KIND_INFO[kind]

  const chooseKind = (next: ProviderKind) => {
    setKind(next)
    setCapabilities([...KIND_INFO[next].defaultCapabilities])
    create.reset()
  }

  const missing = (info.needsKey && !apiKey.trim()) || (info.needsBaseUrl && !baseUrl.trim())
  const pending = create.isPending || assign.isPending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (missing || pending) return
    let provider: Provider
    try {
      provider = await create.mutateAsync({
        body: {
          kind,
          display_name: name.trim() || null,
          base_url: info.needsBaseUrl ? baseUrl.trim() : null,
          api_key: apiKey.trim() || null,
          capabilities: info.chooseCapabilities ? capabilities : null,
        },
      })
    } catch {
      return // shown below the form
    }
    // Endpoints without recommended models: use the typed model where nothing serves yet.
    if (info.chooseCapabilities && model.trim()) {
      const status = await queryClient.fetchQuery({ ...aiStatusOptions(), staleTime: 0 })
      const purposes = [
        ...MODEL_PURPOSES,
        ...(capabilities.includes('vision') ? (['vision'] as const) : []),
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

  const kindItems = KINDS.map((k) => ({ value: k, label: KIND_INFO[k].name() }))

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <fieldset disabled={pending} className="space-y-4">
        <div>
          <Label id={kindId} className="mb-2">
            {m.ai_provider_kind()}
          </Label>
          <Select
            value={kind}
            items={kindItems}
            onValueChange={(next) => next && chooseKind(next as ProviderKind)}
          >
            <SelectTrigger aria-labelledby={kindId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">{info.hint()}</p>
        </div>
        {info.needsBaseUrl ? (
          <TextField
            label={m.ai_provider_base_url()}
            placeholder={info.baseUrlPlaceholder}
            value={baseUrl}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        ) : null}
        <TextField
          label={info.needsKey ? m.ai_provider_api_key() : m.ai_provider_api_key_optional()}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          ref={info.needsKey ? focusOnMount : undefined}
          hint={m.ai_provider_key_note()}
          onChange={(e) => setApiKey(e.target.value)}
        />
        {info.chooseCapabilities ? (
          <>
            <CapabilityChecks value={capabilities} onChange={setCapabilities} />
            <TextField
              label={m.ai_provider_default_model()}
              hint={m.ai_provider_default_model_hint()}
              value={model}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setModel(e.target.value)}
            />
          </>
        ) : null}
        <TextField
          label={m.ai_provider_name()}
          placeholder={info.name()}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        {create.error ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(create.error)}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={missing}>
            {pending ? m.ai_provider_checking() : (submitLabel ?? m.ai_provider_save())}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
