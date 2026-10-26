import canvasLogo from 'simple-icons/icons/canvas.svg?url'
import { ArrowUpRight } from 'lucide-react'
import { useId } from 'react'
import { BrandLogo } from '@/components/BrandLogo'
import { m } from '@/paraglide/messages'
import { Field, FieldDescription, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemContent, ItemTitle } from '@/ui/item'
import type { LmsConfigFormProps, LmsProviderUi } from '../types'

function CanvasLogo({ className }: { className?: string }) {
  return <BrandLogo src={canvasLogo} className={className} />
}

/** The school's Canvas host from what was typed ("q.utoronto.ca"), or null while it is unclear. */
function canvasHost(value: string | undefined): string | null {
  const text = value?.trim() ?? ''
  if (!text) return null
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).host || null
  } catch {
    return null
  }
}

/** Canvas: the school's Canvas address and a personal access token (M09 §2.3). */
function CanvasForm({
  config,
  credentials,
  onConfig,
  onCredentials,
  editing,
  hints,
}: LmsConfigFormProps) {
  const id = useId()
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-url`}>{m.lms_canvas_base_url()}</FieldLabel>
        <Input
          id={`${id}-url`}
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="canvas.example.edu"
          value={config.base_url ?? ''}
          onChange={(e) => onConfig({ ...config, base_url: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-token`}>
          {editing ? m.lms_canvas_new_token() : m.lms_canvas_token()}
        </FieldLabel>
        <Input
          id={`${id}-token`}
          type="password"
          autoComplete="off"
          placeholder={editing ? hints.access_token : undefined}
          value={credentials.access_token ?? ''}
          onChange={(e) => onCredentials({ ...credentials, access_token: e.target.value })}
        />
        {editing ? <FieldDescription>{m.lms_canvas_token_keep()}</FieldDescription> : null}
      </Field>
    </>
  )
}

/** The steps to make a token, always in view: the first links to the typed school's settings. */
function CanvasHelp({ config }: { config: Record<string, string> }) {
  const host = canvasHost(config.base_url)
  return (
    <Item variant="muted" size="sm">
      <ItemContent>
        <ItemTitle>{m.lms_canvas_help_title()}</ItemTitle>
        <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
          <li>
            {host ? (
              <a
                href={`https://${host}/profile/settings`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                {m.lms_canvas_help_step_settings()}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            ) : (
              m.lms_canvas_help_step_settings()
            )}
          </li>
          <li>{m.lms_canvas_help_step_new()}</li>
          <li>{m.lms_canvas_help_step_copy()}</li>
        </ol>
      </ItemContent>
    </Item>
  )
}

export const canvasUi: LmsProviderUi = {
  kind: 'canvas',
  label: m.lms_canvas,
  logo: CanvasLogo,
  description: m.lms_canvas_description,
  summary: (config) =>
    typeof config.base_url === 'string' && config.base_url
      ? config.base_url.replace(/^https?:\/\//, '')
      : null,
  ConfigForm: CanvasForm,
  credentialHelp: CanvasHelp,
  isComplete: ({ config, credentials }, saved) => {
    const url = config.base_url?.trim() ?? ''
    const sameAddress = saved !== null && url === (saved.base_url ?? '')
    return url !== '' && (sameAddress || Boolean(credentials.access_token?.trim()))
  },
}
