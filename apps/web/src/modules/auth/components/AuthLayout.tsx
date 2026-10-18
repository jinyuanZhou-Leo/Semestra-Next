import type { ReactNode } from 'react'
import { LanguageSwitcher } from '@/modules/settings/LanguageSwitcher'
import { m } from '@/paraglide/messages'

/** Brand panel (hidden on narrow screens) beside the form. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-primary-foreground/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/3 -left-16 size-56 rounded-full bg-primary-foreground/10"
        />
        <span className="font-heading text-xl font-semibold tracking-tight">{m.app_name()}</span>
        <p className="relative max-w-sm font-heading text-3xl leading-snug font-medium">
          {m.auth_brand_tagline()}
        </p>
      </aside>
      <main className="relative flex items-center justify-center p-6 sm:p-10">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-sm">
          <span className="mb-8 block font-heading text-lg font-semibold tracking-tight lg:hidden">
            {m.app_name()}
          </span>
          {children}
        </div>
      </main>
    </div>
  )
}
