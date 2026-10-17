import { errorMessage } from '@/lib/errors'

export function FormError({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {errorMessage(error)}
    </p>
  )
}
