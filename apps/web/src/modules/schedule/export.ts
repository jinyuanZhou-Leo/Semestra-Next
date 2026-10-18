import { domToPng } from 'modern-screenshot'

/** PNG of a rendered node at twice its size, on its own background color (M04 §5.4). */
export async function renderPng(node: HTMLElement): Promise<string> {
  return domToPng(node, {
    scale: 2,
    backgroundColor: getComputedStyle(node).backgroundColor || undefined,
  })
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** One A4 landscape page per image, each scaled to fit inside a margin. */
export async function pngsToPdf(pngs: readonly string[]): Promise<Blob> {
  const { PDFDocument, PageSizes } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const [height, width] = PageSizes.A4
  const margin = 28
  for (const png of pngs) {
    const image = await pdf.embedPng(dataUrlBytes(png))
    const scale = Math.min((width - 2 * margin) / image.width, (height - 2 * margin) / image.height)
    const page = pdf.addPage([width, height])
    page.drawImage(image, {
      x: (width - image.width * scale) / 2,
      y: height - margin - image.height * scale,
      width: image.width * scale,
      height: image.height * scale,
    })
  }
  const bytes = await pdf.save()
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
}
