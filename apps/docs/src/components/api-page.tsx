'use client'
import { createOpenAPIPage } from 'fumadocs-openapi/ui'

// No "try it" playground: the docs site is a different origin from any Semestra API.
// The schema is left out of the page props (`includeDocument: false` in lib/openapi.ts) and loaded
// here as one shared chunk, so each reference page doesn't carry its own copy of it.
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
  loadDocument: async () =>
    (await import('../../../../packages/api-client/openapi.json')).default as never,
})
