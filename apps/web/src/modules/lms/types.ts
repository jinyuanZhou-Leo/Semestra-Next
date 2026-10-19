import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Message } from '@/app/extensions'

/**
 * The frontend side of an LMS provider (M09 §2.1), contributed to `lms.providerUi`. The backend
 * provider of the same `kind` checks what the form sends (`config_model`, `credentials_model`).
 */
export type LmsProviderUi = {
  kind: string
  label: Message
  logo: LucideIcon
  ConfigForm: ComponentType<LmsConfigFormProps>
  /** How to get the credentials, shown folded under the form. */
  credentialHelp?: ComponentType
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
