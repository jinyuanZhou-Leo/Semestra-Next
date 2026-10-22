import type { ReactNode } from 'react'

// Only `/`, which sends visitors to their language; every other page lives under `[lang]`.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
