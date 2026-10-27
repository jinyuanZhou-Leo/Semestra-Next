import type { ComponentType } from 'react'
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
  ConfigForm: ComponentType<LmsConfigFormProps>
  /** How to get the credentials, shown under the form; `config` is what is typed so far. */
  credentialHelp?: ComponentType<{ config: Record<string, string> }>
  /**
   * Whether the form can be sent; the server still checks everything. `saved` is the config of
   * the connection being edited (null when adding): a new address needs the credentials again.
   */
  isComplete: (
    form: { config: Record<string, string>; credentials: Record<string, string> },
    saved: Record<string, string> | null,
  ) => boolean
}

export type LmsConfigFormProps = {
  config: Record<string, string>
  credentials: Record<string, string>
  onConfig: (next: Record<string, string>) => void
  onCredentials: (next: Record<string, string>) => void
  /** Editing a saved connection: empty credentials keep the saved ones; `hints` are their masks. */
  editing: boolean
  hints: Record<string, string>
}

export const LMS_PROVIDER_UI = 'lms.providerUi'
