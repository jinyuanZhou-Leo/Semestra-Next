import { GraduationCap, Languages } from 'lucide-react'

import { APP_URL, copy, home, type Lang } from '@/i18n'
import { buttonVariants } from '@/ui/button'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/ui/navigation-menu'

export function Nav({ lang }: { lang: Lang }) {
  const t = copy[lang].nav
  const other: Lang = lang === 'en' ? 'zh-CN' : 'en'
  return (
    <header className="site-nav" id="nav">
      <div className="wrap flex h-15 items-center gap-5">
        <a
          href={home(lang)}
          className="mr-2 flex items-center gap-2 font-heading text-lg font-extrabold tracking-tight"
        >
          <GraduationCap aria-hidden className="size-5.5 text-primary" />
          Semestra
        </a>
        <NavigationMenu className="max-[900px]:hidden">
          <NavigationMenuList>
            {[
              ['#today', t.product],
              ['#sem', 'Sem'],
              ['#more', t.open],
            ].map(([href, label]) => (
              <NavigationMenuItem key={label}>
                <NavigationMenuLink href={href} className={navigationMenuTriggerStyle()}>
                  {label}
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
        <div className="ml-auto flex items-center gap-1.5">
          <a href={home(other)} hrefLang={other} className={buttonVariants({ variant: 'ghost' })}>
            <Languages data-icon="inline-start" />
            {t.other}
          </a>
          <a
            href={`${APP_URL}/login`}
            className={buttonVariants({ variant: 'ghost', className: 'max-[900px]:hidden' })}
          >
            {t.login}
          </a>
          <a href={`${APP_URL}/login`} className={buttonVariants()}>
            {t.start}
          </a>
        </div>
      </div>
    </header>
  )
}
