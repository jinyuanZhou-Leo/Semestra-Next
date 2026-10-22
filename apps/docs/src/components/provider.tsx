'use client'
import SearchDialog from '@/components/search'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ComponentProps, ReactNode } from 'react'

// next-themes renders an inline <script> that sets the theme class before paint. It only runs
// from the server HTML; when React creates it on the client (switching root layouts, dev), React
// 19 logs "Encountered a script tag". A data-block type on the client keeps it inert and silent.
const themeScriptProps = typeof window === 'undefined' ? undefined : { type: 'application/json' }

export function Provider({
  children,
  i18n,
}: {
  children: ReactNode
  i18n: ComponentProps<typeof RootProvider>['i18n']
}) {
  return (
    <RootProvider i18n={i18n} search={{ SearchDialog }} theme={{ scriptProps: themeScriptProps }}>
      {children}
    </RootProvider>
  )
}
