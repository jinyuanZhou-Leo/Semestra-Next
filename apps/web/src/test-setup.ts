import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { vi } from 'vitest'
import { FakeEventSource } from './test-event-source'

// jsdom gaps used by input-otp and Base UI.
document.elementFromPoint ??= () => null
// cmdk scrolls the selected command into view.
Element.prototype.scrollIntoView ??= () => {}
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList
// jsdom prints "not implemented" for scrolling, which the router does on every navigation.
window.scrollTo = () => {}
// Calligraph splits text into per-character nodes; tests read the plain text.
vi.mock('calligraph', () => ({
  Calligraph: ({ children, className }: { children?: string | number; className?: string }) =>
    createElement('span', { className }, children),
}))
globalThis.EventSource ??= FakeEventSource as unknown as typeof EventSource
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Vitest runs with `globals: false`, so Testing Library cannot register its own cleanup.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
afterEach(() => cleanup())
