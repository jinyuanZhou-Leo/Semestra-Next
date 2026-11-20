import { Suspense } from 'react'
import { useExtensions } from '@/app/registry'
import { FIELD_ORIGINS, type FieldOrigin, type FieldOriginProps } from './field-origins'

/**
 * The contributed buttons for one field of the assessment or task being edited. A button whose
 * code loads on demand is preloaded by the page that shows the form (`preloadExtensions`); were it
 * still loading, the field shows without it rather than the form waiting.
 */
export function FieldOrigins(props: FieldOriginProps) {
  const origins = useExtensions<FieldOrigin>(FIELD_ORIGINS)
  return origins.map((origin) => (
    <Suspense key={`${origin.id}:${props.targetId}:${props.field}`} fallback={null}>
      <origin.Button {...props} />
    </Suspense>
  ))
}
