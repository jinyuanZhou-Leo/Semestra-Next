import { errorMessage } from '@/lib/errors'
import { FieldError } from '@/ui/field'

export function FormError({ error }: { error: unknown }) {
  if (!error) return null
  return <FieldError>{errorMessage(error)}</FieldError>
}
