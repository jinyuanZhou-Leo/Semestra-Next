import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Semestra Docs' }

// A static export has no middleware: pick the language in the browser, with a plain
// redirect to English when scripts are off.
const pickLanguage = `location.replace(navigator.languages.some((l) => l.toLowerCase().startsWith('zh')) ? '/zh' : '/en');`

export default function Page() {
  return (
    <>
      <noscript>
        <meta httpEquiv="refresh" content="0; url=/en" />
      </noscript>
      <script dangerouslySetInnerHTML={{ __html: pickLanguage }} />
      <a href="/en">Semestra Docs</a>
    </>
  )
}
