import { source } from '@/lib/source'
import { createFromSource } from 'fumadocs-core/search/server'

export const revalidate = false

// The default `multilingual` tokenizer handles English and Chinese; static mode exports one
// index the browser downloads, so search works without a server.
export const { staticGET: GET } = createFromSource(source)
