import { School } from 'lucide-react'
import { useId } from 'react'
import { m } from '@/paraglide/messages'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { Field, FieldDescription, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import type { LmsConfigFormProps, LmsProviderUi } from '../types'

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

function CanvasHelp() {
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-sm text-primary hover:underline">
        {m.lms_canvas_help_title()}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="pt-2 text-sm text-muted-foreground">{m.lms_canvas_help_body()}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const canvasUi: LmsProviderUi = {
  kind: 'canvas',
  label: m.lms_canvas,
  logo: School,
  ConfigForm: CanvasForm,
  credentialHelp: CanvasHelp,
  isComplete: ({ config, credentials }, saved) => {
    const url = config.base_url?.trim() ?? ''
    const sameAddress = saved !== null && url === (saved.base_url ?? '')
    return url !== '' && (sameAddress || Boolean(credentials.access_token?.trim()))
  },
}
