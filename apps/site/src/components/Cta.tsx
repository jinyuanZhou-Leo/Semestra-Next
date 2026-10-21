import { ArrowDown, ArrowUpRight, ChevronRight } from 'lucide-react'

import { APP_URL, GITHUB_URL } from '@/i18n'
import { buttonVariants } from '@/ui/button'

export function StartButton({ label }: { label: string }) {
  return (
    <a href={`${APP_URL}/login`} className={buttonVariants({ size: 'lg' })}>
      {label}
    </a>
  )
}

/** The outline "get started" next to a section heading. */
export function StartLink({ label }: { label: string }) {
  return (
    <a href={`${APP_URL}/login`} className={buttonVariants({ variant: 'outline' })}>
      {label}
      <ChevronRight data-icon="inline-end" />
    </a>
  )
}

export function ExploreButton({ label }: { label: string }) {
  return (
    <a href="#today" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
      {label}
      <ArrowDown data-icon="inline-end" />
    </a>
  )
}

export function GitHubButton() {
  return (
    <a href={GITHUB_URL} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
      GitHub
      <ArrowUpRight data-icon="inline-end" />
    </a>
  )
}
