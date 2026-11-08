import type { ComponentType, ReactNode } from 'react'
import type { Message } from '@/app/extensions'

/** A platform's mark: a lucide icon or a brand logo, drawn at the size `className` gives it. */
export type LmsLogo = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/**
 * The frontend side of an LMS provider (M09 §2.1), contributed to `lms.providerUi`. The backend
 * provider of the same `kind` checks what the form sends (`config_model`, `credentials_model`).
 */

export type LmsProviderUi = {
  kind: string
  /** The platform's name, used in every generic string ("Import courses from {provider}"). */
  label: Message
  logo: LmsLogo
  /** One line under the name when picking a platform for a new connection. */
  description?: Message
  /** What identifies a saved connection besides its name, e.g. Canvas' host. */
  summary?: (config: Record<string, unknown>) => string | null
  /** `preloadable()`: it loads when the connections section shows, not with the app. */
  ConfigForm: ComponentType<LmsConfigFormProps>
  /**
   * Whether the form can be sent; the server still checks everything. `saved` is the config of
   * the connection being edited (null when adding): a new address needs the credentials again.
   * `signIn` is the address pasted back from the school's login page when that method is used.
   */
  isComplete: (
    form: {
      config: Record<string, string>
      credentials: Record<string, string>
      signIn: string
    },
    saved: Record<string, string> | null,
  ) => boolean
}

/** How a step of the form ends. By default: the name field, then "Check and save". */
export type LmsFormStep = {
  /** A step before the last one: no name field, and this button instead of saving. */
  next?: { label: string; disabled: boolean; onClick: () => void; secondary?: boolean }
  /** A step with its own way forward (a list to pick from): no name field, no main button. */
  noAction?: boolean
  /** The last step still misses what it asks for. */
  saveDisabled?: boolean
  /** The fields show `saveError` on the field it is about, so the form does not repeat it. */
  showsSaveError?: boolean
  /** Instead of the form's own Back (to the platform list), if any. */
  back?: () => void
}

export type LmsConfigFormProps = {
  config: Record<string, string>
  credentials: Record<string, string>
  onConfig: (next: Record<string, string>) => void
  onCredentials: (next: Record<string, string>) => void
  /** The address the school's sign-in page ended on (when the server offers that method). */
  signIn: string
  onSignIn: (next: string) => void
  /** This server allows connecting by signing in on the platform's own page. */
  signInEnabled: boolean
  /** Editing a saved connection: empty credentials keep the saved ones; `hints` are their masks. */
  editing: boolean
  hints: Record<string, string>
  kind: string
  /** Why the last save failed, in words. */
  saveError: string | null
  /** Lays out the form's fields with the rest of the form; what the provider's form returns. */
  frame: (fields: ReactNode, step?: LmsFormStep) => ReactNode
}

export const LMS_PROVIDER_UI = 'lms.providerUi'
