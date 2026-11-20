import { lmsConnectionListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { NamespaceForm } from '@/app/settings/NamespaceForm'
import { useProviderName } from '../providers'
import { MATERIALS } from '../queries'
import { HeldMaterials } from './HeldMaterials'

/** Where materials are kept matters only while they come in. */
export const MATERIAL_FIELDS = { when: { store: 'sync' } }

/**
 * Account settings → LMS → Course materials (M09 §4.2): how every linked course takes in its
 * materials. A course can set its own in its LMS section, where each choice starts as "Follow
 * global settings". With the sync off, what came in before can be removed.
 */
export function MaterialsSection() {
  const connections = useQuery(lmsConnectionListOptions()).data?.items ?? []
  const kinds = [...new Set(connections.map((c) => c.provider))]
  // The platform's name when all connections are of one; "LMS" otherwise.
  const provider = useProviderName(kinds.length === 1 ? kinds[0] : null) ?? 'LMS'
  return (
    <div className="space-y-4">
      <NamespaceForm
        namespace={MATERIALS}
        level="account"
        fields={MATERIAL_FIELDS}
        params={{ provider }}
      />
      <HeldMaterials provider={provider} />
    </div>
  )
}
