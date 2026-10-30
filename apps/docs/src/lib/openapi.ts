import { createOpenAPI } from 'fumadocs-openapi/server'

// Exported by `pnpm gen:api` (`semestra openapi`); the reference pages are generated from it.
// The pages load the schema themselves (components/api-page.tsx) instead of each embedding it.
export const openapi = createOpenAPI({
  input: ['../../packages/api-client/openapi.json'],
  includeDocument: false,
})
