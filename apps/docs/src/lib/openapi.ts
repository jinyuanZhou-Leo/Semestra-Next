import { createOpenAPI } from 'fumadocs-openapi/server'

// Exported by `pnpm gen:api` (`semestra openapi`); the reference pages are generated from it.
export const openapi = createOpenAPI({
  input: ['../../packages/api-client/openapi.json'],
})
