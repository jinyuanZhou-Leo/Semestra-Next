'use client'
import { createOpenAPIPage } from 'fumadocs-openapi/ui'

// No "try it" playground: the docs site is a different origin from any Semestra API.
export const OpenAPIPage = createOpenAPIPage({ playground: { enabled: false } })
