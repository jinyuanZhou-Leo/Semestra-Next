import { useSyncExternalStore } from 'react'

type Size = { width: number; height: number }

// The last size each observed element reported. Reading it keeps renders (a board re-renders on
// every pointer move while a card is resized) from forcing a layout to measure again.
const sizes = new WeakMap<Element, Size>()

function measure(element: Element): Size {
  const rect = element.getBoundingClientRect()
  const size = { width: Math.round(rect.width), height: Math.round(rect.height) }
  sizes.set(element, size)
  return size
}

function useElementSize(element: HTMLElement | null, axis: keyof Size): number {
  return useSyncExternalStore(
    (onChange) => {
      if (!element || typeof ResizeObserver === 'undefined') return () => {}
      const observer = new ResizeObserver(([entry]) => {
        const box = entry?.borderBoxSize?.[0]
        if (box)
          sizes.set(element, {
            width: Math.round(box.inlineSize),
            height: Math.round(box.blockSize),
          })
        else measure(element)
        onChange()
      })
      observer.observe(element)
      return () => observer.disconnect()
    },
    () => (element ? (sizes.get(element) ?? measure(element))[axis] : 0),
    () => 0,
  )
}

/**
 * The width of `element` in px, following resizes; 0 until the element is attached. Read during
 * render (unlike react-grid-layout's `useContainerWidth`, which measures in an effect), so the
 * first painted frame already has the right column count.
 */
export function useElementWidth(element: HTMLElement | null): number {
  return useElementSize(element, 'width')
}

/** The height of `element` in px, following resizes; 0 until attached. See `useElementWidth`. */
export function useElementHeight(element: HTMLElement | null): number {
  return useElementSize(element, 'height')
}
