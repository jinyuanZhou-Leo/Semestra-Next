import { getLocale } from '@/paraglide/runtime'

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(value))
}
