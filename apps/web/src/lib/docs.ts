import { getLocale } from '@/paraglide/runtime'

/** The public docs; self-hosted builds link there too. */
const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? 'https://semestra.jyleo.cc/docs'

/** A docs page in the interface language, e.g. `docsUrl('mcp/tools')`; the home page without a path. */
export function docsUrl(path = ''): string {
  const base = `${DOCS_URL}/${getLocale() === 'zh-CN' ? 'zh' : 'en'}`
  return path ? `${base}/${path}` : base
}
