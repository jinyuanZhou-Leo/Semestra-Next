import { lmsConnectionSignInStartMutation } from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import canvasLogo from 'simple-icons/icons/canvas.svg?url'
import {
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  Info,
  KeyRound,
  TriangleAlert,
} from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { BrandLogo } from '@/components/BrandLogo'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import type { LmsConfigFormProps, LmsProviderUi } from '../types'

type Method = 'sign_in' | 'token'
/**
 * The school sign-in, one thing at a time, after a notice of what the user takes on. `saved` is
 * an existing sign-in that can just stay: its owner has seen the notice.
 */
type SignInStep = 'saved' | 'notice' | 'address' | 'login' | 'paste'

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

/** Null asks first. A saved connection opens on the method it uses. */
function defaultMethod(
  signInEnabled: boolean,
  editing: boolean,
  hints: Record<string, string>,
): Method | null {
  if (!signInEnabled) return 'token'
  if (!editing) return null
  return hints.method === 'sign_in' ? 'sign_in' : 'token'
}

function MethodOption({
  icon,
  title,
  description,
  onPick,
}: {
  icon: ReactNode
  title: string
  description: string
  onPick: () => void
}) {
  return (
    <Item
      variant="outline"
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Item's children label it
      render={<button type="button" />}
      className="text-left"
      onClick={onPick}
    >
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </Item>
  )
}

function StepHeading({ step, title }: { step: number; title: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {m.lms_canvas_sign_in_step({ current: step, total: 3 })}
      </p>
      <p className="font-medium">{title}</p>
    </div>
  )
}

/**
 * Canvas: where the server allows both, first how to connect. A personal token is one form; the
 * school sign-in is a few steps, because each happens somewhere else (M09 §7.1).
 */
function CanvasForm({
  config,
  credentials,
  onConfig,
  onCredentials,
  signIn,
  onSignIn,
  signInEnabled,
  editing,
  hints,
  kind,
  saveError,
  frame,
}: LmsConfigFormProps) {
  const id = useId()
  // Undefined until the user picks: the default follows the provider list once it has loaded.
  const [picked, setPicked] = useState<Method | null>()
  const method = picked !== undefined ? picked : defaultMethod(signInEnabled, editing, hints)
  const savedSignIn = editing && hints.method === 'sign_in'
  const [step, setStep] = useState<SignInStep>(savedSignIn ? 'saved' : 'notice')
  const start = useMutation(lmsConnectionSignInStartMutation())
  const address = config.base_url?.trim() ?? ''
  // A real link, opened by the user's own click: browsers block a tab opened after a request.
  const loginUrl = start.data?.authorize_url

  const toMethods = () => setPicked(null)
  const pick = (next: Method) => {
    setPicked(next)
    if (next === 'token') onSignIn('')
    else onCredentials({})
    start.reset()
  }

  const addressField = ({
    onEnter,
    error,
    description,
  }: { onEnter?: () => void; error?: string; description?: string } = {}) => (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`${id}-url`}>{m.lms_canvas_base_url()}</FieldLabel>
      <Input
        id={`${id}-url`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-url-error` : undefined}
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        placeholder="canvas.example.edu"
        value={config.base_url ?? ''}
        onChange={(e) => {
          onConfig({ ...config, base_url: e.target.value })
          // What came from the old address is no use for the new one.
          onSignIn('')
          start.reset()
        }}
        onKeyDown={(e) => {
          if (!onEnter || e.key !== 'Enter') return
          e.preventDefault()
          onEnter()
        }}
      />
      {error ? <FieldError id={`${id}-url-error`}>{error}</FieldError> : null}
      {description && !error ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )

  if (method === null) {
    return frame(
      <ItemGroup className="gap-2" aria-label={m.lms_canvas_method()}>
        <MethodOption
          icon={<GraduationCap aria-hidden className="size-5" />}
          title={m.lms_canvas_method_sign_in()}
          description={m.lms_canvas_method_sign_in_description()}
          onPick={() => pick('sign_in')}
        />
        <MethodOption
          icon={<KeyRound aria-hidden className="size-5" />}
          title={m.lms_canvas_method_token()}
          description={m.lms_canvas_method_token_description()}
          onPick={() => pick('token')}
        />
      </ItemGroup>,
      { noAction: true },
    )
  }

  if (method === 'token') {
    return frame(
      <>
        {addressField()}
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
        <CanvasHelp config={config} />
      </>,
      signInEnabled ? { back: toMethods } : undefined,
    )
  }

  if (step === 'saved') {
    return frame(
      <>
        {addressField({ description: m.lms_canvas_sign_in_keep() })}
        <div>
          <Button type="button" variant="outline" onClick={() => setStep('address')}>
            {m.lms_canvas_sign_in_again()}
          </Button>
        </div>
      </>,
      { back: toMethods },
    )
  }

  if (step === 'notice') {
    return frame(
      <Alert variant="destructive">
        <TriangleAlert aria-hidden />
        <AlertTitle>{m.lms_canvas_sign_in_notice_title()}</AlertTitle>
        <AlertDescription>
          <p>{m.lms_canvas_sign_in_notice_description()}</p>
          <p className="mt-2 font-medium">{m.lms_canvas_sign_in_notice_responsibility()}</p>
        </AlertDescription>
      </Alert>,
      {
        back: toMethods,
        next: {
          label: m.lms_canvas_sign_in_notice_accept(),
          disabled: false,
          onClick: () => setStep('address'),
        },
      },
    )
  }

  if (step === 'address') {
    const getLink = () => {
      if (!address || start.isPending) return
      start.mutate(
        { body: { provider: kind, config: { base_url: address } } },
        { onSuccess: () => setStep('login') },
      )
    }
    return frame(
      <>
        <StepHeading step={1} title={m.lms_canvas_sign_in_step_address()} />
        {addressField({
          onEnter: getLink,
          error: start.error ? errorMessage(start.error) : undefined,
        })}
      </>,
      {
        back: () => setStep(savedSignIn ? 'saved' : 'notice'),
        next: {
          label: start.isPending
            ? m.lms_canvas_sign_in_preparing()
            : m.lms_canvas_sign_in_continue(),
          disabled: !address || start.isPending,
          onClick: getLink,
        },
      },
    )
  }

  if (step === 'login') {
    return frame(
      <>
        <StepHeading step={2} title={m.lms_canvas_sign_in_step_login()} />
        <p className="text-muted-foreground">{m.lms_canvas_sign_in_step_login_description()}</p>
        <div className="flex justify-center">
          <Button
            size="lg"
            nativeButton={false}
            render={
              <a
                href={loginUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={m.lms_canvas_sign_in_open()}
              />
            }
          >
            <ExternalLink aria-hidden />
            {m.lms_canvas_sign_in_open()}
          </Button>
        </div>
        <Alert>
          <Info aria-hidden />
          <AlertTitle>{m.lms_canvas_sign_in_not_found_title()}</AlertTitle>
          <AlertDescription>{m.lms_canvas_sign_in_not_found_description()}</AlertDescription>
        </Alert>
      </>,
      {
        back: () => setStep('address'),
        next: {
          label: m.lms_canvas_sign_in_continue(),
          disabled: false,
          onClick: () => setStep('paste'),
          // Opening the login comes first on this step.
          secondary: true,
        },
      },
    )
  }

  return frame(
    <>
      <StepHeading step={3} title={m.lms_canvas_sign_in_step_paste()} />
      <Field data-invalid={saveError ? true : undefined}>
        <FieldLabel htmlFor={`${id}-callback`}>{m.lms_canvas_sign_in_paste()}</FieldLabel>
        <Input
          id={`${id}-callback`}
          aria-invalid={saveError ? true : undefined}
          aria-describedby={saveError ? `${id}-callback-error` : undefined}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://sso.canvaslms.com/canvas/login?code=…"
          value={signIn}
          onChange={(e) => onSignIn(e.target.value)}
        />
        {saveError ? (
          <FieldError id={`${id}-callback-error`}>{saveError}</FieldError>
        ) : (
          <FieldDescription>{m.lms_canvas_sign_in_paste_hint()}</FieldDescription>
        )}
      </Field>
    </>,
    { back: () => setStep('login'), saveDisabled: !signIn.trim(), showsSaveError: true },
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
  isComplete: ({ config, credentials, signIn }, saved) => {
    const url = config.base_url?.trim() ?? ''
    if (!url) return false
    const sameAddress = saved !== null && url === (saved.base_url ?? '')
    if (signIn.trim()) return true
    if (sameAddress) return true
    return Boolean(credentials.access_token?.trim())
  },
}
