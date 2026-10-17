import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './openapi.json',
  output: { path: './src/generated', postProcess: [] },
  plugins: [
    '@hey-api/typescript',
    '@hey-api/client-fetch',
    '@hey-api/sdk',
    { name: '@tanstack/react-query', queryOptions: true, mutationOptions: true, queryKeys: true },
  ],
})
