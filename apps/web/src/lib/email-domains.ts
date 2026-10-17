// Domains suggested after the "@" while typing an email. Override at build time with
// VITE_EMAIL_DOMAINS="school.edu,gmail.com".
const DEFAULT_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'qq.com',
  '163.com',
  '126.com',
  'mail.utoronto.ca',
]

export const EMAIL_DOMAINS: readonly string[] = import.meta.env.VITE_EMAIL_DOMAINS
  ? String(import.meta.env.VITE_EMAIL_DOMAINS)
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
  : DEFAULT_DOMAINS

/** Full addresses that complete what has been typed, e.g. "ann@gm" → ["ann@gmail.com"]. */
export function suggestEmails(value: string, domains: readonly string[] = EMAIL_DOMAINS): string[] {
  const at = value.indexOf('@')
  if (at <= 0) return []
  const local = value.slice(0, at)
  const typed = value.slice(at + 1).toLowerCase()
  return domains
    .filter((d) => d.startsWith(typed) && d !== typed)
    .slice(0, 4)
    .map((d) => `${local}@${d}`)
}
