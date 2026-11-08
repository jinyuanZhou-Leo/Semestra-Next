import canvasLogo from 'simple-icons/icons/canvas.svg?url'
import { preloadable } from '@/app/extensions'
import { BrandLogo } from '@/components/BrandLogo'
import { m } from '@/paraglide/messages'
import type { LmsProviderUi } from '../types'

function CanvasLogo({ className }: { className?: string }) {
  return <BrandLogo src={canvasLogo} className={className} />
}

export const canvasUi: LmsProviderUi = {
  kind: 'canvas',
  label: m.lms_canvas,
  logo: CanvasLogo,
  description: m.lms_canvas_description,
  summary: (config) =>
    typeof config.base_url === 'string' && config.base_url
      ? config.base_url.replace(/^https?:\/\//, '')
      : null,
  // The form loads when a connection is added or edited, not with the app.
  ConfigForm: preloadable(() => import('./CanvasForm')),
  isComplete: ({ config, credentials, signIn }, saved) => {
    const url = config.base_url?.trim() ?? ''
    if (!url) return false
    const sameAddress = saved !== null && url === (saved.base_url ?? '')
    if (signIn.trim()) return true
    if (sameAddress) return true
    return Boolean(credentials.access_token?.trim())
  },
}
