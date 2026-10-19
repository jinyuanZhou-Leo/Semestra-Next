import {
  lmsProgramBindingGetOptions,
  lmsProvidersListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useExtensions } from '@/app/registry'
import { LMS_PROVIDER_UI, type LmsProviderUi } from '../types'

export { canvasUi } from './canvas'

/** The provider UIs contributed to `lms.providerUi`, by kind. */
export function useProviderUis(): ReadonlyMap<string, LmsProviderUi> {
  const uis = useExtensions<LmsProviderUi>(LMS_PROVIDER_UI)
  return new Map(uis.map((ui) => [ui.kind, ui]))
}

/**
 * The platforms a new connection can use: what the server offers (`lms.providers.list`) and the
 * frontend has a form for, in the server's order.
 */
export function useOfferedProviders(): { providers: LmsProviderUi[]; isPending: boolean } {
  const uis = useProviderUis()
  const query = useQuery(lmsProvidersListOptions())
  const providers = (query.data?.items ?? []).flatMap((p) => {
    const ui = uis.get(p.kind)
    return ui ? [ui] : []
  })
  return { providers, isPending: query.isPending }
}

/** A provider kind's display name: its UI label, else the server's name, else the kind. */
export function useProviderName(kind: string | null | undefined): string | null {
  const ui = useProviderUis().get(kind ?? '')
  const offered = useQuery({ ...lmsProvidersListOptions(), enabled: Boolean(kind) && !ui }).data
  if (!kind) return null
  return ui?.label() ?? offered?.items.find((p) => p.kind === kind)?.display_name ?? kind
}

/** The name of the platform the Program is bound to; null while unbound or loading. */
export function useProgramProviderName(programId: string): string | null {
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } })).data
  return useProviderName(binding?.connection?.provider)
}
