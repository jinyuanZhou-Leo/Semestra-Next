import type { ComponentProps } from 'react'
import { preloadable } from '@/app/extensions'
import type { PdfViewer } from './PdfViewer'

/**
 * The PDF viewer, loaded on first use: pdf.js is large. `preloadable` (not `lazy`) so a viewer
 * whose code is already downloaded renders without the Suspense fallback flashing.
 */
export const LazyPdfViewer = preloadable<ComponentProps<typeof PdfViewer>>(() =>
  import('./PdfViewer').then((mod) => ({ default: mod.PdfViewer })),
)
