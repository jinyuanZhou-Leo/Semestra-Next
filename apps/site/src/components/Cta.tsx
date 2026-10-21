import { ArrowDown, ArrowUpRight } from 'lucide-react'

import { APP_URL, GITHUB_URL } from '@/i18n'
import { buttonVariants } from '@/ui/button'

export function StartButton({ label }: { label: string }) {
  return (
    <a href={`${APP_URL}/login`} className={buttonVariants({ size: 'lg' })}>
      {label}
    </a>
  )
}

export function WalkButton({ label }: { label: string }) {
  return (
    <a href="#day-1" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
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
