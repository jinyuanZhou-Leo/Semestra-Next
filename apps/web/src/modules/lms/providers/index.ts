import { useExtensions } from '@/app/registry'
import { LMS_PROVIDER_UI, type LmsProviderUi } from '../types'

export { canvasUi } from './canvas'

/** The provider UIs contributed to `lms.providerUi`, by kind. */
export function useProviderUis(): ReadonlyMap<string, LmsProviderUi> {
  const uis = useExtensions<LmsProviderUi>(LMS_PROVIDER_UI)
  return new Map(uis.map((ui) => [ui.kind, ui]))
}
